import { Router } from "express";
import axios from "axios";
import { extractMicro1 } from "../extractors/micro1.extractor.js";

const router = Router();

console.log("Extract router loaded");

router.post("/micro1", async (req, res) => {

    console.log("========== NEW REQUEST ==========");
    console.log("POST /extract/micro1 hit");

    try {

        console.log("Request body:", req.body);

        const { url } = req.body;

        console.log("URL:", url);

        if (!url) {
            return res.status(400).json({
                success: false,
                message: "Missing URL"
            });
        }

        const response = await axios.get(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36"
            }
        });

        console.log("Downloaded HTML:", response.data.length);

        const job = extractMicro1(
            response.data,
            url
        );

        console.log("Extractor finished");

        res.status(200).json(job);

    } catch (error: any) {

        console.error("FULL ERROR:");
        console.error(error);

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

export default router;