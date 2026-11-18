import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { exportPdfSchema, exportParcellaireSchema } from "./exports.schema.js";
import * as service from "./exports.service.js";
import { requireRecord, requireUser } from "../../shared/request.js";
import { NotFoundApiError, getErrorMessage } from "../../shared/errors.js";

export default async function exportRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/v2/pdf/:numeroBio/:recordId",
    exportPdfSchema,
    async (request, reply) => {
      const force = (request.query.force_refresh ?? "false") === "true";
      const pac = (request.query.pac ?? "false") === "true";
      const zip = (request.query.zip ?? "false") === "true";

      if (String(requireRecord(request).numerobio) !== request.params.numeroBio) {
        throw new NotFoundApiError("Parcellaire introuvable");
      }

      try {
        const generator = service.generatePDF(
          request.params.numeroBio,
          request.params.recordId,
          force,
          pac,
          zip
        );
        const numberParcelle = (await generator.next()).value;
        if ((numberParcelle as number) > 80) return reply.code(204).send();

        const document = (await generator.next()).value;
        if (typeof document !== "string") throw new Error("Le document généré est invalide");
        reply.header(
          "Content-Type",
          zip ? "application/zip" : "application/zip"
        );
        return reply.code(200).send(document);
      } catch (error) {
        return reply.code(400).send({ message: getErrorMessage(error) });
      }
    }
  );

  app.post(
    "/api/v2/exportParcellaire",
    exportParcellaireSchema,
    async (request, reply) => {
      const user = requireUser(request);
      const data = await service.exportDataOcId(
        user.organismeCertificateur.id,
        request.body.payload,
        user.id
      );
      if (data === null)
        throw new Error(
          "Une erreur s'est produite, impossible d'exporter les parcellaires"
        );
      return reply.code(200).send(data);
    }
  );
}
