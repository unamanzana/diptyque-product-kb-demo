import productionData from "@/data/diptyque-frontend-data.json";
import schemaV1Candidate from "../../data-pipeline/diptyque_frontend_schema_v1_candidate.json";

export const schemaV1PreviewEnabled =
  process.env.NEXT_PUBLIC_DIPTYQUE_SCHEMA_V1 === "true";

const frontendData = schemaV1PreviewEnabled ? schemaV1Candidate : productionData;

export default frontendData;
