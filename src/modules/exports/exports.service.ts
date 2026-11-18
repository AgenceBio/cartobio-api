import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import config from '../../config/env.js'
import { fetchOperatorByNumeroBio } from '../../clients/agence-bio.client.js'
import { AttestationsProductionsStatus, AttestationsProductionsType } from '@agencebio/cartobio-types'
import type { ExportParcellaireBody, ExportParcellaireResponse } from '@agencebio/cartobio-types'
import type { ArchiveOperator, ExportRow, PdfParcelle } from './exports.types.js'
import { getAllParcelles } from './pdf-utils.js'
import { createPdfContent } from './pdf-content.js'
import * as repository from './exports.repository.js'
import { findControlBodyOperators } from '../operators/operators.service.js'
import { InvalidRequestApiError, NotFoundApiError, isHandledError } from '../../shared/errors.js'

async function updateProductions(
  recordId: string,
  status: AttestationsProductionsStatus,
  types: AttestationsProductionsType[],
  paths: string[] = []
): Promise<void> {
  await Promise.all(
    types.map((type, index) => repository.updateAttestationsProductions(recordId, status, type, paths[index] ?? null))
  )
}

function assertParcellesCanProducePdf(parcelles: PdfParcelle[], recordId: string): void {
  if (parcelles.length === 0) throw new InvalidRequestApiError(`Aucune parcelle trouvée pour l'opérateur ${recordId}`)
  if (
    parcelles.some(
      ({ cultures }) => !Array.isArray(cultures) || cultures.length === 0 || !cultures.some(({ CPF }) => Boolean(CPF))
    )
  ) {
    throw new InvalidRequestApiError("Culture manquante, impossible de générer l'attestation du parcellaire")
  }
  if (
    parcelles.some(
      (p) =>
        !p.name &&
        (p.nbilot == null || p.nbilot === '') &&
        (p.nbp == null || p.nbp === '') &&
        (p.refcad == null || (Array.isArray(p.refcad) && p.refcad.every((r) => r === '' || r == null)))
    )
  ) {
    throw new InvalidRequestApiError("Nom manquant de parcelle, impossible de générer l'attestation du parcellaire")
  }
}

function archivePdfs(paths: string[], operator: ArchiveOperator): string {
  const zip = new AdmZip()
  paths.forEach((pdfPath, index): void => {
    const name =
      index === 0
        ? `cartobio_attestation_PAC_${operator.annee_reference_controle}_${operator.numeroBio}.pdf`
        : index === 1
          ? `cartobio_liste_PAC_${operator.annee_reference_controle}_${operator.numeroBio}.pdf`
          : `fichier_${index}.pdf`
    zip.addLocalFile(pdfPath, '', name)
  })
  return zip.toBuffer().toString('base64')
}

const pdfsInProgress = new Set<string>()
const MAX_PDF_GENERATIONS = 10
const PDF_QUEUED = Number.POSITIVE_INFINITY
let runningPdfGenerations = 0
const pdfGenerationQueue: Array<() => void> = []

async function acquirePdfSlot(): Promise<void> {
  if (runningPdfGenerations < MAX_PDF_GENERATIONS) {
    runningPdfGenerations++
    return
  }
  await new Promise<void>((resolve) => pdfGenerationQueue.push(resolve))
}

function releasePdfSlot(): void {
  const next = pdfGenerationQueue.shift()
  if (next) next()
  else runningPdfGenerations--
}

async function* generatePDF(
  numeroBio: string,
  recordId: string,
  force = false,
  pac = false,
  zip = false
): AsyncGenerator<number, string> {
  const types =
    pac || zip
      ? [AttestationsProductionsType.PACDETAILS, AttestationsProductionsType.PACCOMPLET]
      : [AttestationsProductionsType.COMPLET]
  if (!force) {
    const productions = (
      await Promise.all(types.map((type) => repository.findValidAttestationProduction(recordId, type)))
    ).filter((production) => production !== null)
    const [production] = productions
    if (production) {
      try {
        const document = zip
          ? archivePdfs(
              productions.map(({ path }) => path),
              { annee_reference_controle: '', numeroBio }
            )
          : await fs.promises.readFile(production.path, { encoding: 'base64' })
        yield 0
        return document
      } catch {
        // Sinon on regenere le fichier
      }
    }
  }
  const lockKey = `${recordId}_${pac || zip}`
  if (pdfsInProgress.has(lockKey)) {
    throw new InvalidRequestApiError("Une génération de l'attestation est déjà en cours pour ce parcellaire.")
  }
  pdfsInProgress.add(lockKey)
  const isQueued = runningPdfGenerations >= MAX_PDF_GENERATIONS || pdfGenerationQueue.length > 0
  let hasSlot = false
  try {
    await updateProductions(recordId, AttestationsProductionsStatus.STARTED, types)
    if (isQueued) yield PDF_QUEUED
    await acquirePdfSlot()
    hasSlot = true
    const [operatorData, record, parcelles] = await Promise.all([
      fetchOperatorByNumeroBio(numeroBio),
      repository.findPdfRecord(recordId),
      getAllParcelles(recordId, pac || zip)
    ])
    if (!record) throw new NotFoundApiError(`Parcellaire introuvable : ${recordId}`)
    assertParcellesCanProducePdf(parcelles, recordId)
    if (!isQueued) yield parcelles.length
    const operator = { ...operatorData, ...record }
    const pdfs = await createPdfContent(numeroBio, recordId, parcelles, operator, pac || zip)
    const directory = config.get('attestationsProductions.directory')
    const paths: string[] = []
    for (const [index, pdf] of pdfs.entries()) {
      const filename = path.resolve(directory, `${recordId}_${pac || zip ? 'PAC' : 'complet'}_${index}.pdf`)
      await fs.promises.writeFile(filename, await pdf.save())
      paths.push(filename)
    }
    await updateProductions(recordId, AttestationsProductionsStatus.GENERATED, types, paths)
    const [pdf] = pdfs
    if (!pdf) throw new Error(`Aucun PDF généré pour le parcellaire ${recordId}`)
    return zip ? archivePdfs(paths, operator) : pdf.saveAsBase64()
  } catch (error) {
    await updateProductions(recordId, AttestationsProductionsStatus.ERROR, types)
    if (isHandledError(error)) throw error
    throw new Error("Une erreur s'est produite, impossible de générer l'attestation du parcellaire", { cause: error })
  } finally {
    pdfsInProgress.delete(lockKey)
    if (hasSlot) releasePdfSlot()
  }
}

async function deleteRecordAttestations(recordId: string): Promise<void> {
  const directory = config.get('attestationsProductions.directory')
  const files = (await fs.promises.readdir(directory)).filter(
    (file) => file.includes(recordId) && file.toLowerCase().endsWith('.pdf')
  )
  await Promise.all(files.map((file) => fs.promises.rm(path.join(directory, file), { force: true })))
  await repository.deleteAttestationsProductions(recordId)
}

async function exportDataOcId(
  ocId: number,
  filter: ExportParcellaireBody['payload'],
  userId: number
): Promise<ExportParcellaireResponse> {
  const records = (
    await findControlBodyOperators({
      ocId,
      userId,
      input: filter.input,
      filter: filter.filterForSearch
    })
  ).sort((a, b) => Number(a.numeroBio) - Number(b.numeroBio))
  const rows: ExportRow[] = []
  for (let index = 0; index < records.length; index += 10000)
    rows.push(
      ...(await repository.findExportRows(
        ocId,
        records.slice(index, index + 10000).map(({ numeroBio }) => Number(numeroBio))
      ))
    )
  const byNumeroBio = new Map(records.map((operator) => [String(operator.numeroBio), operator]))
  return rows.map((row) => {
    const operator = byNumeroBio.get(String(row.numerobio))
    return {
      ...row,
      numeroclient: operator?.notifications?.numeroClient ?? '',
      siret: operator?.siret,
      raisonSociale: operator?.nom,
      codePostal: operator?.codePostal,
      commune: operator?.commune
    }
  })
}

export { findValidAttestationProduction } from './exports.repository.js'
export { generatePDF, exportDataOcId, deleteRecordAttestations }
