import axios, { AxiosInstance } from "axios";

import type { Micro1PortalResponseDTO } from "../dto/micro1-portal-response.dto.js";

export class Micro1Client {
    private client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: "https://prod-api.micro1.ai/api/v1",
            timeout: 30000,
            headers: {
                "Content-Type": "application/json",
            },
        });
    }

    async getJobs(
        page: number = 1,
        limit: number = 18
    ): Promise<Micro1PortalResponseDTO> {
        try {
            const { data } = await this.client.post(
                "/job/portal",
                {
                    action: "get_all_jobs",
                    filters: {
                        type: ["EXPERT"],
                    },
                },
                {
                    params: {
                        page,
                        limit,
                        keyword: "",
                    },
                }
            );

            console.log({
                total: data.total,
                page: data.page,
                limit: data.limit,
                totalPages: data.total_pages,
              });

              console.log("Returned jobs:", data.data.length);
    
            return data;
        } catch (error: any) {
            console.error("Micro1 API Error:");
            console.error(error.response?.data);
    
            throw error;
        }
    }

    async fetch(url: string): Promise<string> {
        const { data } = await axios.get<string>(url);

        return data;
    }
}
