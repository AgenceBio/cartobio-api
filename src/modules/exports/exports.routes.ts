import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { exportPdfSchema, exportParcellaireSchema } from "./exports.schema.js";
import * as service from "./exports.service.js";
import { requireOcUser, requireRecord } from "../../shared/request.js";
import { NotFoundApiError } from "../../shared/errors.js";

export default async function exportRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/v2/pdf/:numeroBio/:recordId",
    exportPdfSchema,
    async (request, reply) => {
      const { force_refresh: force, pac, zip } = request.query;

      if (String(requireRecord(request).numerobio) !== request.params.numeroBio) {
        throw new NotFoundApiError("Parcellaire introuvable");
      }

      const generator = service.generatePDF(
        request.params.numeroBio,
        request.params.recordId,
        force,
        pac,
        zip
      );
      const numberParcelle = (await generator.next()).value;
      if ((numberParcelle as number) > 80) {
        reply.code(204).send();
        generator.next().catch((err) => request.log.error({ err }, "Génération PDF en tâche de fond en échec"));
        return reply;
      }

      const document = (await generator.next()).value;
      if (typeof document !== "string") throw new Error("Le document généré est invalide");
      reply.header("Content-Type", "application/zip");
      return reply.code(200).send(document);
    }
  );

  app.post(
    "/api/v2/exportParcellaire",
    exportParcellaireSchema,
    async (request, reply) => {
      const user = requireOcUser(request);
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
