import axios from "axios";

const client = axios.create({
    baseURL: "https://prod-api.micro1.ai/api/v1",
});

export async function fetchMicro1Jobs(
    page: number = 1,
    limit: number = 18
) {
    const { data } = await client.post(
        `/job/portal?page=${page}&limit=${limit}&keyword=`
    );

    return data;
}