#!/usr/bin/env node

import cliProgress from 'cli-progress'
import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../src/database/database.js'
import { importPac } from '../src/database/schema/index.js'
import { findLastAuditedRecordId } from '../src/shared/parcellaires/parcellaires.repository.js'
import type { RecordInput } from '../src/shared/parcellaires/parcellaires.types.js'
import { fetchCustomersByOc } from '../src/clients/agence-bio.client.js'
import { createOrUpdateOperatorRecord } from '../src/shared/parcellaires/parcellaires.service.js'
import { hideImport } from '../src/modules/operators/operators.service.js'
import type { OrganismeCertificateur } from '@agencebio/cartobio-types'

const [, , xlsxPath, ocId] = process.argv

if (xlsxPath === undefined || ocId === undefined) {
  console.error('Usage: node create-parcellaire-import-pac-xlsx.js <XLSX> <OC_ID>')
  process.exit(1)
}

type XmlNode = { '#text'?: unknown } | string | number | undefined
type XmlCell = { '@_r': string; '@_t'?: string; v?: XmlNode; is?: { t?: XmlNode } }

function readFirstSheetRows(filePath: string): Array<Record<string, string | undefined>> {
  const zip = new AdmZip(filePath)
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name): boolean => ['si', 'r', 'row', 'c'].includes(name)
  })
  const text = (node: XmlNode): string => String(typeof node === 'object' ? (node['#text'] ?? '') : (node ?? ''))
  const sharedStrings: string[] = (parser.parse(zip.readAsText('xl/sharedStrings.xml') || '<sst/>').sst?.si ?? []).map(
    (si: { t?: XmlNode; r?: Array<{ t?: XmlNode }> }) =>
      si.t !== undefined ? text(si.t) : (si.r ?? []).map((run) => text(run.t)).join('')
  )
  const sheetXml = zip.readAsText('xl/worksheets/sheet1.xml')
  if (!sheetXml) {
    console.error('Aucune feuille dans le fichier XLSX.')
    process.exit(1)
  }
  const cellValue = (cell: XmlCell): string =>
    cell['@_t'] === 's'
      ? (sharedStrings[Number(text(cell.v))] ?? '')
      : cell['@_t'] === 'inlineStr'
        ? text(cell.is?.t)
        : text(cell.v)
  const [header = {}, ...data] = (parser.parse(sheetXml).worksheet?.sheetData?.row ?? []).map(
    (row: { c?: XmlCell[] }): Record<string, string> =>
      Object.fromEntries((row.c ?? []).map((cell) => [cell['@_r'].replace(/\d+$/, ''), cellValue(cell)]))
  )
  return data.map((row: Record<string, string>) =>
    Object.fromEntries(Object.entries(header as Record<string, string>).map(([column, name]) => [name, row[column]]))
  )
}

;(async (): Promise<void> => {
  const rows = readFirstSheetRows(xlsxPath)
  const codesBio = rows
    .map((r) => r['Code bio'])
    .filter(Boolean)
    .map(String)

  if (codesBio.length === 0) {
    console.error('Aucun "Code bio" trouvé dans le fichier XLSX.')
    process.exit(1)
  }

  const operators = await fetchCustomersByOc(+ocId)

  const [firstOperator] = operators
  if (!firstOperator) {
    console.warn("Aucun numerobio pour l'oc", ocId)
    process.exit(0)
  }
  const oc = firstOperator.organismeCertificateur as OrganismeCertificateur

  if (oc.id !== +ocId) {
    console.warn('Id invalide lors de la récupération des parcellaires', oc)
    process.exit(1)
  }

  const operatorBioNumbers = new Set(operators.map((o) => o.numeroBio.toString()))

  const validCodesBio = codesBio.filter((nb) => operatorBioNumbers.has(nb))
  const invalidCodesBio = codesBio.filter((nb) => !validCodesBio.includes(nb))

  if (validCodesBio.length > 0) {
    console.log('Nombre de codes bios importées : ', validCodesBio.length)
  }

  if (invalidCodesBio.length > 0) {
    console.warn('Codes bio ignorés (non trouvés chez cet OC):', invalidCodesBio.join(', '))
  }

  if (validCodesBio.length === 0) {
    console.error('Aucun code bio valide trouvé. Fin du script.')
    process.exit(0)
  }

  const parcellairesACreer = await db
    .select({ record: importPac.record, numerobio: sql<string>`${importPac.numeroBio}` })
    .from(importPac)
    .where(and(inArray(importPac.numeroBio, validCodesBio), eq(importPac.imported, false)))
  const numerobioACreer = parcellairesACreer.map((r) => r.numerobio)
  const parcellairesDejaImportes = validCodesBio.filter((nb) => !numerobioACreer.includes(nb))

  if (parcellairesDejaImportes.length > 0) {
    console.warn('Codes bio déjà importés :', parcellairesDejaImportes.join(', '))
  }

  const progress = new cliProgress.SingleBar({ etaBuffer: 10000 }, cliProgress.Presets.rect)
  progress.start(parcellairesACreer.length, 0)

  try {
    for (const parcelle of parcellairesACreer) {
      const previousRecordId = await findLastAuditedRecordId(parcelle.numerobio)

      const { id: ocIdNum, nom: ocLabel } = oc
      const record = await createOrUpdateOperatorRecord(
        { numerobio: parcelle.numerobio, oc_id: ocIdNum, oc_label: ocLabel, ...(parcelle.record as RecordInput) },
        {
          user: null,
          copyParcellesData: previousRecordId != null,
          previousRecordId: previousRecordId ?? undefined
        }
      )

      if (record.numerobio !== parcelle.numerobio) {
        console.error(
          "Erreur d'import pour le numéro: %s, résultat: numéro bio: %s, parcellaire: %s",
          parcelle.numerobio,
          record.numerobio,
          record.record_id
        )
        process.exit(1)
      }

      await hideImport(parcelle.numerobio)
      progress.increment()
    }
  } catch (error) {
    console.error(error)
    process.exit(1)
  } finally {
    progress.stop()
  }
})()
