// routes/image-proxy.routes.js
import { Router } from "express";
import axios from "axios";
const r = Router();

r.get("/image-proxy", async (req, res) => {
    const src = String(req.query.src || "");
    if (!/^https?:\/\//i.test(src)) return res.status(400).send("bad src");
    try {
        const resp = await axios.get(src, {
            responseType: "arraybuffer",
            timeout: 30000,
            maxRedirects: 5,
            headers: {
                "User-Agent": "Mozilla/5.0",
                Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                Referer: "https://megatenwiki.com/wiki/Main_Page",
            },
            validateStatus: () => true,
        });
        if (resp.status !== 200) return res.status(resp.status).send(resp.statusText);
        res.set("Content-Type", resp.headers["content-type"] || "application/octet-stream");
        res.send(resp.data);
    } catch (e) {
        res.status(502).send(String(e?.message || e));
    }
});

export default r;
