import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import axios from "axios";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API to fetch Google Form HTML
  app.get("/api/fetch-form", async (req, res) => {
    let { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      // Follow redirects to handle forms.gle short URLs
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        },
        maxRedirects: 5
      });
      
      const html = response.data;
      const $ = cheerio.load(html);
      
      // Extract the form schema from the script variable
      let schemaScript = "";
      $("script").each((_, script) => {
        const text = $(script).text();
        if (text.includes("FB_PUBLIC_LOAD_DATA_")) {
          schemaScript = text;
        }
      });

      // Send the final URL, the title, and the schema script (or full HTML fallback)
      res.json({ 
        html: schemaScript || html.slice(0, 50000), 
        originalHtmlMarkup: html.slice(0, 20000), // Some context for AI
        finalUrl: response.request.res.responseUrl || url 
      });
    } catch (error: any) {
      console.error("Error fetching form:", error.message);
      res.status(500).json({ error: "Failed to fetch form" });
    }
  });

  // API to submit Google Form
  app.post("/api/submit-form", async (req, res) => {
    const { url, data, proxy } = req.body;
    if (!url || !data) {
      return res.status(400).json({ error: "URL and data are required" });
    }

    // Google Forms submission URL is typically /formResponse
    const submissionUrl = url.replace(/\/viewform.*$/, "/formResponse");

    try {
      // Use URLSearchParams for form-encoded data
      const params = new URLSearchParams();
      for (const key in data) {
        if (data[key] !== undefined && data[key] !== null) {
          params.append(key, data[key]);
        }
      }

      console.log(`Submitting to: ${submissionUrl}`);
      if (proxy) console.log(`Using Proxy: ${proxy}`);
      console.log(`Payload keys: ${Object.keys(data).join(", ")}`);

      const axiosConfig: any = {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "Origin": "https://docs.google.com",
          "Referer": url
        },
        // Don't throw on 4xx/5xx so we can see the body
        validateStatus: () => true 
      };

      if (proxy) {
        try {
          axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
          // Also disable standard proxy settings if any
          axiosConfig.proxy = false;
        } catch (e: any) {
          console.error("Invalid proxy URL:", e.message);
        }
      }

      const response = await axios.post(submissionUrl, params.toString(), axiosConfig);

      if (response.status >= 400) {
        console.error(`Google Form returned ${response.status}:`, response.data?.slice(0, 500));
        return res.status(response.status).json({ 
          error: "Google Form rejected submission", 
          status: response.status,
          details: "This usually means a required field is missing or format is invalid." 
        });
      }

      res.json({ success: true, status: response.status });
    } catch (error: any) {
      console.error("Internal Error submitting form:", error.message);
      res.status(500).json({ error: "Internal server error during submission", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
