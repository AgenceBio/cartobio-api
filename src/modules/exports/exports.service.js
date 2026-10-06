"use strict";

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const config = require("../../../src/config/env.js");
const {
  fetchOperatorByNumeroBio,
} = require("../../../src/clients/agence-bio.client.js");
const {
  AttestationsProductionsStatus,
  AttestationsProductionsType,
} = require("../../../src/shared/enums.js");
const { getAllParcelles } = require("./pdf-utils.js");
const { createPdfContent } = require("./pdf-content.js");
const repository = require("./exports.repository.js");
const {
  searchControlBodyRecords,
} = require("../operators/operators.service.js");

async function updateProductions(recordId, status, types, paths = []) {
  await Promise.all(
    types.map((type, index) =>
      repository.updateAttestationsProductions(
        recordId,
        status,
        type,
        paths[index] ?? null
      )
    )
  );
}

function assertParcellesCanProducePdf(parcelles, recordId) {
  if (parcelles.length === 0)
    throw new Error(`Aucune parcelle trouvée pour l'opérateur ${recordId}`);
  if (
    parcelles.some(
      ({ cultures }) =>
        !Array.isArray(cultures) ||
        cultures.length === 0 ||
        !cultures.some(({ CPF }) => Boolean(CPF))
    )
  ) {
    throw new Error(
      "Culture manquante, impossible de générer l'attestation du parcellaire"
    );
  }
  if (
    parcelles.some(
      (p) =>
        !p.name &&
        (p.nbilot == null || p.nbilot === "") &&
        (p.nbp == null || p.nbp === "") &&
        (p.refcad == null ||
          (Array.isArray(p.refcad) &&
            p.refcad.every((r) => r === "" || r == null)))
    )
  ) {
    throw new Error(
      "Nom manquant de parcelle, impossible de générer l'attestation du parcellaire"
    );
  }
}

function archivePdfs(paths, operator) {
  const zip = new AdmZip();
  paths.forEach((pdfPath, index) => {
    const name =
      index === 0
        ? `cartobio_attestation_PAC_${operator.annee_reference_controle}_${operator.numeroBio}.pdf`
        : index === 1
        ? `cartobio_liste_PAC_${operator.annee_reference_controle}_${operator.numeroBio}.pdf`
        : `fichier_${index}.pdf`;
    zip.addLocalFile(pdfPath, "", name);
  });
  return zip.toBuffer().toString("base64");
}

async function* generatePDF(
  numeroBio,
  recordId,
  force = false,
  pac = false,
  zip = false
) {
  const types =
    pac || zip
      ? [
          AttestationsProductionsType.PACDETAILS,
          AttestationsProductionsType.PACCOMPLET,
        ]
      : [AttestationsProductionsType.COMPLET];
  if (!force) {
    const productions = (
      await Promise.all(
        types.map((type) =>
          repository.findValidAttestationProduction(recordId, type)
        )
      )
    ).filter(Boolean);
    if (productions.length > 0) {
      yield 0;
      try {
        if (!zip)
          return fs.readFileSync(productions[0].path, { encoding: "base64" });
        return archivePdfs(
          productions.map(({ path }) => path),
          { annee_reference_controle: "", numeroBio }
        );
      } catch {
        // Sinon on regenere le fichier
      }
    }
  }
  await updateProductions(
    recordId,
    AttestationsProductionsStatus.STARTED,
    types
  );
  try {
    const [operatorData, record, parcelles] = await Promise.all([
      fetchOperatorByNumeroBio(numeroBio),
      repository.findPdfRecord(recordId),
      getAllParcelles(recordId, pac || zip),
    ]);
    if (!record) throw new Error(`Parcellaire introuvable : ${recordId}`);
    assertParcellesCanProducePdf(parcelles, recordId);
    yield parcelles.length;
    const operator = { ...operatorData, ...record };
    const pdfs = await createPdfContent(
      numeroBio,
      recordId,
      parcelles,
      operator,
      pac || zip
    );
    const directory = config.get("attestationsProductions.directory");
    const paths = [];
    for (const [index, pdf] of pdfs.entries()) {
      const filename = path.resolve(
        directory,
        `${recordId}_${pac ? "PAC" : "complet"}_${index}.pdf`
      );
      await fs.promises.writeFile(filename, await pdf.save());
      paths.push(filename);
    }
    await updateProductions(
      recordId,
      AttestationsProductionsStatus.GENERATED,
      types,
      paths
    );
    return zip ? archivePdfs(paths, operator) : pdfs[0].saveAsBase64();
  } catch (error) {
    await updateProductions(
      recordId,
      AttestationsProductionsStatus.ERROR,
      types
    );
    throw new Error(
      "Une erreur s'est produite, impossible de générer l'attestation du parcellaire",
      { cause: error }
    );
  }
}

async function exportDataOcId(ocId, filter, userId) {
  try {
    const operators = await searchControlBodyRecords({
      ocId,
      userId,
      input: filter.input,
      page: 1,
      limit: Infinity,
      filter: filter.filterForSearch,
    });
    const records = [...operators.records].sort((a, b) =>
      a.numeroBio === b.numeroBio
        ? new Date(b.created_at) - new Date(a.created_at)
        : Number(a.numeroBio) - Number(b.numeroBio)
    );
    const rows = [];
    for (let index = 0; index < records.length; index += 10000)
      rows.push(
        ...(await repository.findExportRows(
          ocId,
          records
            .slice(index, index + 10000)
            .map(({ numeroBio }) => String(numeroBio))
        ))
      );
    const byNumeroBio = new Map(
      records.map((operator) => [String(operator.numeroBio), operator])
    );
    return rows.map((row) => {
      const operator = byNumeroBio.get(String(row.numerobio));
      return {
        ...row,
        numeroclient: operator?.notifications?.numeroClient ?? "",
        siret: operator?.siret,
        raisonSociale: operator?.nom,
        codePostal: operator?.codePostal,
        commune: operator?.commune,
      };
    });
  } catch (error) {
    console.error(error);
    return null;
  }
}

module.exports = {
  generatePDF,
  exportDataOcId,
  findValidAttestationProduction: repository.findValidAttestationProduction,
};
