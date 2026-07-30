import { Micro1JobSummaryDTO } from "./micro1-job-summary.dto.js";

export interface Micro1PortalResponseDTO {
    status: boolean;

    message: string;

    statusCode: number;

    total: number;

    data: Micro1JobSummaryDTO[];
}