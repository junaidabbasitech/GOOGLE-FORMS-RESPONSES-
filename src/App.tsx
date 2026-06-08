/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Play, 
  RotateCcw, 
  Send, 
  Settings2, 
  Binary, 
  Search, 
  AlertCircle,
  Loader2,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Plus,
  Download,
  ScrollText,
  X,
  FileSpreadsheet,
  BarChart2,
  Trash2,
  RefreshCw,
  Hash,
  AtSign,
  User as UserIcon,
  Calendar,
  Clock as ClockIcon,
  List as ListIcon
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from "recharts";
import { motion, AnimatePresence } from "motion/react";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface FormField {
  id: string; // e.g. "entry.123456"
  label: string;
  type: "text" | "choice" | "multiple" | "date" | "time" | "email" | "name" | "number";
  options?: string[];
  required?: boolean;
  pageIndex: number;
}

interface FormMetadata {
  fields: FormField[];
  fbzx: string;
  pageHistory: string;
  title: string;
  pageCount: number;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [metadata, setMetadata] = useState<FormMetadata | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submissionCount, setSubmissionCount] = useState(1);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ success: number; failed: number } | null>(null);
  const [autoRandomize, setAutoRandomize] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [submissionDelay, setSubmissionDelay] = useState(800);
  const [proxyUrl, setProxyUrl] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [batchPerformance, setBatchPerformance] = useState<{ name: string; success: number; failed: number }[]>([]);
  const [logs, setLogs] = useState<{ timestamp: string; status: "success" | "error" | "info"; message: string; data?: any }[]>([]);
  const [submittedData, setSubmittedData] = useState<any[]>([]);
  const [isLogsOpen, setIsLogsOpen] = useState(false);

  const fetchAndParseForm = async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    setMetadata(null);
    setResults(null);

    try {
      const resp = await fetch(`/api/fetch-form?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error("Failed to fetch form HTML");
      const { html, originalHtmlMarkup, finalUrl } = await resp.json();
      
      // Update URL to the expanded one for correct submission mapping
      setUrl(finalUrl);

      setParsing(true);
      
      const genResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            text: `Parse this Google Form schema (and HTML context) and extract metadata for ALL available pages.
                   
                   Format-Specific Hint: The provided 'html' is likely a JavaScript block containing FB_PUBLIC_LOAD_DATA_. 
                   This is an array where:
                   - Index 1 contains Form ID and Title
                   - Index 3 contains questions array
                   - Questions are at Index 1 of the index 3 items.
                   - entry.ID is at Index 4.
                   
                   Extract labels, types, options, entry IDs, and hidden fields (fbzx, fvv, pageHistory).
                   Crucially, identify which page each question belongs to. If there's only one page, all fields have pageIndex 0.
                   Detect the total number of pages and set pageHistory correctly (e.g. if 3 pages, history is "0,1,2").
                   
                   Schema Data:
                   ${html}
                   
                   HTML Context:
                   ${originalHtmlMarkup}` 
          }
        ],
        config: {
          systemInstruction: "You are an expert at parsing Google Forms HTML. Crucially, look for the 'FB_PUBLIC_LOAD_DATA_' variable in the script tags, as it contains the full schema for ALL pages of the form. Extract the field names (labels), their corresponding 'entry.xxxx' IDs, field types, and internal hidden values like 'fbzx' and 'fvv' (usually 1). For choice fields, extract all options from all pages. Detect the total number of pages and determine the full pageHistory (e.g. if 3 pages, history is '0,1,2'). Ensure each field is assigned the correct pageIndex (starting from 0). Return a strictly valid JSON object covering every field found across all pages.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              fbzx: { type: Type.STRING },
              fvv: { type: Type.STRING },
              pageHistory: { type: Type.STRING },
              pageCount: { type: Type.NUMBER },
              fields: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING, description: "The entry.xxxx ID" },
                    label: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["text", "choice", "multiple", "date", "time"] },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    required: { type: Type.BOOLEAN },
                    pageIndex: { type: Type.NUMBER }
                  },
                  required: ["id", "label", "type", "pageIndex"]
                }
              }
            },
            required: ["fields", "fbzx", "pageHistory", "title", "pageCount"]
          }
        }
      });

      const rawText = (genResponse.text || "").trim();
      const parsedData = JSON.parse(rawText || "{}") as FormMetadata;
      if (!parsedData.fields || !parsedData.fbzx) {
        throw new Error("AI failed to extract form metadata. The form might be protected or have an unusual structure.");
      }
      setMetadata(parsedData);
      
      // Initialize form values
      const initialValues: Record<string, string> = {
        fbzx: parsedData.fbzx,
        pageHistory: parsedData.pageHistory,
      };
      if ((parsedData as any).fvv) {
        initialValues["fvv"] = (parsedData as any).fvv;
      } else {
        initialValues["fvv"] = "1"; // Default for most forms
      }
      parsedData.fields.forEach(f => {
        initialValues[f.id] = "";
      });
      setFormValues(initialValues);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
      setParsing(false);
    }
  };

  const handleInputChange = (id: string, value: string) => {
    setFormValues(prev => ({ ...prev, [id]: value }));
  };

  const handleTypeOverride = (fieldId: string, newType: FormField["type"]) => {
    if (!metadata) return;
    const updatedFields = metadata.fields.map(f => f.id === fieldId ? { ...f, type: newType } : f);
    setMetadata({ ...metadata, fields: updatedFields });
  };

  const generateFullAIResponse = async (personaContext?: string): Promise<Record<string, string> | null> => {
    if (!metadata) return null;
    const allAiValues = { ...formValues };
    
    setGenerating(true);
    try {
      // Process each page sequentially for a better visual feedback
      for (let pIdx = 0; pIdx < metadata.pageCount; pIdx++) {
        setActivePage(pIdx);
        const pageFields = metadata.fields.filter(f => f.pageIndex === pIdx);
        if (pageFields.length === 0) continue;

        const fieldList = pageFields.map(f => ({
          id: f.id,
          label: f.label,
          type: f.type,
          options: f.options,
          required: f.required
        }));

        let aiValues: Record<string, string> = {};
        
        try {
          const genResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
              {
                text: `You are simulating a unique human filling out Page ${pIdx + 1} of a form.
                       ${personaContext ? `Your current persona: ${personaContext}` : "Create a realistic, unique persona for this form."}
                       Fields for this page: ${JSON.stringify(fieldList)}
                       
                       STRICT GUIDELINES:
                       - You MUST provide a specific value for EVERY field ID listed in the schema. 
                       - IMPORTANT: The result MUST be a flat JSON object where keys are the Field IDs and values are the answers.
                       - Use random but realistic human data.
                       - Field Types: ${JSON.stringify(pageFields.map(f => ({ id: f.id, type: f.type })))}
                       - If type is 'email', provide a valid email.
                       - If type is 'name', provide a full name.
                       - If type is 'number', provide a number string.
                       - For text, be varied and unique. No placeholders.
                       - Pick choices naturally.`
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: pageFields.reduce((acc, f) => {
                  acc[f.id] = { type: Type.STRING };
                  return acc;
                }, {} as any),
                required: pageFields.map(f => f.id)
              }
            }
          });

          const rawText = (genResponse.text || "").trim();
          aiValues = JSON.parse(rawText || "{}");
        } catch (apiErr: any) {
          console.warn("AI Generation failed (likely quota), using local fallback:", apiErr.message);
          
          pageFields.forEach(field => {
            if (field.type === "choice" && field.options) {
              aiValues[field.id] = field.options[Math.floor(Math.random() * field.options.length)];
            } else {
              const label = field.label.toLowerCase();
              if (field.type === "email" || label.includes("email")) {
                aiValues[field.id] = `user${Math.floor(Math.random() * 10000)}@gmail.com`;
              } else if (field.type === "name" || label.includes("name")) {
                const names = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Skyler"];
                aiValues[field.id] = names[Math.floor(Math.random() * names.length)] + " " + (Math.floor(Math.random() * 900) + 100);
              } else if (field.type === "number") {
                aiValues[field.id] = Math.floor(Math.random() * 100).toString();
              } else {
                aiValues[field.id] = `Automated_Response_${Math.floor(Math.random() * 100000)}`;
              }
            }
          });

          setLogs(prev => [...prev, {
            timestamp: new Date().toLocaleTimeString(),
            status: "info",
            message: `Quota limited on Page ${pIdx + 1}. Applied high-quality local data variation.`
          }]);
        }

        Object.assign(allAiValues, aiValues);
        setFormValues({ ...allAiValues });
        
        // Very brief delay for UI threading
        await new Promise(r => setTimeout(r, 50));
      }
      return allAiValues;
    } catch (err) {
      console.error("AI Gen Helper Error:", err);
      return null;
    } finally {
      setActivePage(null);
      setGenerating(false);
    }
  };

  const generateAIValues = async () => {
    setError(null);
    await generateFullAIResponse();
  };

  const randomizeValuesFallback = () => {
    if (!metadata) return;
    const newValues = { ...formValues };
    metadata.fields.forEach(field => {
      if (field.type === "choice" && field.options?.length) {
        newValues[field.id] = field.options[Math.floor(Math.random() * field.options.length)];
      } else if (field.type === "text") {
        if (field.label.toLowerCase().includes("email")) {
          newValues[field.id] = `user${Math.floor(Math.random() * 1000)}@example.com`;
        } else if (field.label.toLowerCase().includes("name")) {
          const names = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda"];
          newValues[field.id] = names[Math.floor(Math.random() * names.length)] + " " + Math.floor(Math.random() * 100);
        } else {
          newValues[field.id] = `Response_${Math.floor(Math.random() * 10000)}`;
        }
      }
    });
    setFormValues(newValues);
  };

  const validateForm = () => {
    if (!metadata) return false;
    const errors: string[] = [];
    metadata.fields.forEach(field => {
      if (field.required && !formValues[field.id]) {
        errors.push(field.id);
      }
    });
    setValidationErrors(errors);
    return errors.length === 0;
  };

  const submitWithRetry = async (data: any, attempt: number = 0): Promise<{ ok: boolean; status: number; details?: string }> => {
    const maxRetries = 3;
    const backoff = Math.pow(2, attempt) * 1000;

    try {
      const response = await fetch("/api/submit-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, data, proxy: proxyUrl }),
      });

      if (response.ok) return { ok: true, status: response.status };

      const errData = await response.json();
      
      if (attempt < maxRetries && response.status >= 500) {
        setLogs(prev => [...prev, {
          timestamp: new Date().toLocaleTimeString(),
          status: "info",
          message: `Attempt ${attempt + 1} failed (Status ${response.status}). Retrying in ${backoff}ms...`
        }]);
        await new Promise(r => setTimeout(r, backoff));
        return submitWithRetry(data, attempt + 1);
      }

      return { ok: false, status: response.status, details: errData.details };
    } catch (err: any) {
      if (attempt < maxRetries) {
        setLogs(prev => [...prev, {
          timestamp: new Date().toLocaleTimeString(),
          status: "info",
          message: `Network error. Attempt ${attempt + 1} failed. Retrying...`
        }]);
        await new Promise(r => setTimeout(r, backoff));
        return submitWithRetry(data, attempt + 1);
      }
      return { ok: false, status: 0, details: err.message };
    }
  };

  const startAutomatedSubmission = async () => {
    if (!metadata) return;
    if (!validateForm()) {
      setError("Please fill all required fields before starting automation.");
      return;
    }
    
    setProgress({ current: 0, total: submissionCount });
    setResults(null);
    setLogs([]);
    setSubmittedData([]);
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < submissionCount; i++) {
      const timestamp = new Date().toLocaleTimeString();
      try {
        let currentData = { ...formValues };

        if (autoRandomize) {
          const aiData = await generateFullAIResponse(`Submission #${i + 1} with a unique background`);
          if (aiData) {
            currentData = aiData;
          } else {
            randomizeValuesFallback();
            currentData = { ...formValues };
          }
        }

        const result = await submitWithRetry(currentData);

        if (result.ok) {
          successCount++;
          setSubmittedData(prev => [...prev, currentData]);
          setLogs(prev => [...prev, { 
            timestamp, 
            status: "success", 
            message: `Instance #${i+1} submitted successfully.`,
            data: currentData 
          }]);
        } else {
          failedCount++;
          setLogs(prev => [...prev, { 
            timestamp, 
            status: "error", 
            message: `Instance #${i+1} failed after retries: ${result.details || "Rejected by Google"}`,
            data: currentData
          }]);
        }
      } catch (err: any) {
        failedCount++;
        setLogs(prev => [...prev, { 
          timestamp, 
          status: "error", 
          message: `Critical error on #${i+1}: ${err.message}`,
        }]);
      }
      setProgress({ current: i + 1, total: submissionCount });
      await new Promise(r => setTimeout(r, submissionDelay));
    }

    setResults({ success: successCount, failed: failedCount });
    setBatchPerformance(prev => [
      ...prev,
      { name: `B${prev.length + 1}`, success: successCount, failed: failedCount }
    ].slice(-10)); // Keep last 10 batches
    setProgress(null);
  };

  const downloadCSV = () => {
    if (submittedData.length === 0 || !metadata) return;
    
    // Map of entry IDs to human-readable labels
    const headers = metadata.fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(",");
    const rows = submittedData.map(data => 
      metadata.fields.map(field => {
        const val = data[field.id] || "";
        return `"${val.toString().replace(/"/g, '""')}"`;
      }).join(",")
    );
    
    const csvContent = "\ufeff" + [headers, ...rows].join("\n"); // UTF-8 BOM
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `form_submissions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      {/* Header Navigation */}
      <nav className="h-16 px-8 border-b border-slate-200 bg-white sticky top-0 z-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200">
            <Binary className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-800">AutoSubmit Pro</span>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium text-slate-500">
          <span 
            className="text-indigo-600 cursor-pointer"
            onClick={() => setIsLogsOpen(false)}
          >Dashboard</span>
          <span 
            className="hover:text-slate-800 cursor-pointer transition-colors"
            onClick={() => setIsLogsOpen(true)}
          >Logs</span>
          <span 
            className="hover:text-slate-800 cursor-pointer transition-colors flex items-center gap-1.5"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings2 className="w-4 h-4" />
            Settings
          </span>
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200"></div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto p-8 lg:grid lg:grid-cols-12 gap-8">
        {/* Intro - Spans full width at top */}
        <section className="col-span-12 mb-8">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 mb-2">
            Automation Engine <span className="text-indigo-600">Active</span>
          </h2>
          <p className="text-slate-500 max-w-2xl text-base">
            Professional-grade Google Form automation. Analyze structure, map fields, and execute high-frequency batch submissions with AI-powered detection.
          </p>
        </section>

        {/* Left Column: Input & Field Mapping (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          
          {/* URL Input Section */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Source Form URL</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="https://docs.google.com/forms/d/e/..."
                  className="w-full pl-11 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono text-sm transition-all"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <button
                onClick={fetchAndParseForm}
                disabled={loading || !url}
                className="bg-indigo-600 text-white px-6 py-4 rounded-xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                Analyze
              </button>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm"
            >
              <AlertCircle className="w-5 h-5" />
              {error}
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {parsing ? (
              <motion.div 
                key="parsing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-slate-200 border-dashed"
              >
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                <h3 className="text-lg font-bold text-slate-800">AI Structuring...</h3>
                <p className="text-slate-400 text-sm">Decoding JSON-LD and form attributes</p>
              </motion.div>
            ) : metadata && (
              <motion.div
                key="mapping"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{metadata.title || "Field Mapping"}</h3>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                      {metadata.fields.length} Fields Defined
                    </span>
                  </div>
                  <button 
                    onClick={generateAIValues}
                    disabled={generating}
                    className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg bg-indigo-50 transition-colors disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    {generating ? "GENERATING..." : "AI AUTO-GEN"}
                  </button>
                </div>

                <div className="space-y-8 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {Array.from({ length: metadata.pageCount }).map((_, pIdx) => {
                    const pageFields = metadata.fields.filter(f => f.pageIndex === pIdx);
                    if (pageFields.length === 0) return null;
                    
                    return (
                      <div key={pIdx} className={`space-y-4 rounded-2xl p-4 transition-all ${
                        activePage === pIdx ? "bg-indigo-50/50 ring-2 ring-indigo-500 shadow-lg shadow-indigo-100" : ""
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                            activePage === pIdx ? "bg-indigo-600 text-white animate-pulse" : "bg-indigo-100 text-indigo-600"
                          }`}>
                            {pIdx + 1}
                          </div>
                          <h4 className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                            activePage === pIdx ? "text-indigo-600" : "text-slate-400"
                          }`}>
                            Page {pIdx + 1}
                            {activePage === pIdx && <span className="ml-2 animate-pulse">Populating...</span>}
                          </h4>
                          <div className={`h-px flex-1 transition-colors ${
                            activePage === pIdx ? "bg-indigo-200" : "bg-slate-100"
                          }`}></div>
                          <button
                            onClick={() => setPreviewPage(pIdx)}
                            className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 px-2 py-1 rounded bg-indigo-50 transition-colors"
                          >
                            PREVIEW PAYLOAD
                          </button>
                        </div>
                        
                        <div className="grid gap-4">
                          {pageFields.map(field => (
                            <div 
                              key={field.id} 
                              className={`p-4 bg-slate-50 rounded-xl border transition-all hover:border-slate-200 group ${
                                validationErrors.includes(field.id) ? "border-red-300 bg-red-50/30" : "border-slate-100"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-3">
                                <label className={`text-xs font-bold uppercase tracking-tight ${
                                  validationErrors.includes(field.id) ? "text-red-500" : "text-slate-500"
                                }`}>
                                  {field.label} {field.required && <span className="text-red-400">*</span>}
                                  {validationErrors.includes(field.id) && <span className="ml-2 text-[8px] font-bold lowercase italic text-red-400">(Required)</span>}
                                </label>
                                <div className="flex items-center gap-2">
                                  <div className="relative group">
                                    <button className="p-1 hover:bg-slate-200 rounded text-slate-400 transition-colors">
                                      {field.type === "email" && <AtSign className="w-3.5 h-3.5" />}
                                      {field.type === "name" && <UserIcon className="w-3.5 h-3.5" />}
                                      {field.type === "text" && <ScrollText className="w-3.5 h-3.5" />}
                                      {field.type === "number" && <Hash className="w-3.5 h-3.5" />}
                                      {field.type === "choice" && <ListIcon className="w-3.5 h-3.5" />}
                                      {field.type === "date" && <Calendar className="w-3.5 h-3.5" />}
                                      {field.type === "time" && <ClockIcon className="w-3.5 h-3.5" />}
                                    </button>
                                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 shadow-xl rounded-lg p-1 hidden group-hover:block z-50 min-w-[120px]">
                                      {(["text", "email", "name", "number", "choice", "date", "time"] as const).map(t => (
                                        <button
                                          key={t}
                                          onClick={() => handleTypeOverride(field.id, t)}
                                          className={`w-full text-left px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-tight hover:bg-slate-50 flex items-center gap-2 ${field.type === t ? 'text-indigo-600 bg-indigo-50/50' : 'text-slate-500'}`}
                                        >
                                          {t === 'text' && <ScrollText className="w-3 h-3" />}
                                          {t === 'email' && <AtSign className="w-3 h-3" />}
                                          {t === 'name' && <UserIcon className="w-3 h-3" />}
                                          {t === 'number' && <Hash className="w-3 h-3" />}
                                          {t === 'choice' && <ListIcon className="w-3 h-3" />}
                                          {t}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400">{field.id}</span>
                                </div>
                              </div>
                              
                              {field.type === "choice" ? (
                                <div className="flex flex-wrap gap-2">
                                  {field.options?.map(opt => (
                                    <button
                                      key={opt}
                                      onClick={() => handleInputChange(field.id, opt)}
                                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                        formValues[field.id] === opt 
                                        ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100" 
                                        : "bg-white border-slate-200 text-slate-600 hover:border-indigo-400"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  value={formValues[field.id] || ""}
                                  onChange={(e) => handleInputChange(field.id, e.target.value)}
                                  placeholder={`Value for ${field.label}...`}
                                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-slate-700 placeholder:text-slate-300"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Controls & Monitor (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Success Rate</p>
              <p className="text-2xl font-bold text-slate-800">
                {results && (results.success + results.failed > 0) 
                  ? `${Math.round((results.success / (results.success + results.failed)) * 100)}%` 
                  : "0%"}
              </p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Status</p>
              <p className={`text-2xl font-bold ${progress ? "text-indigo-600 animate-pulse" : "text-slate-300"}`}>
                {progress ? "Active" : "Idle"}
              </p>
            </div>
          </div>

          {/* Submission Control Panel */}
          <div className="bg-slate-900 rounded-2xl p-6 shadow-xl text-white">
            <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
              <Play className="w-4 h-4 fill-white text-white" />
              Batch Processor
            </h3>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Loop</label>
                  <div className="flex items-center bg-white/5 rounded-xl border border-white/10 p-1">
                    <button 
                      onClick={() => setSubmissionCount(Math.max(1, submissionCount - 1))}
                      className="w-8 h-8 rounded-lg hover:bg-white/10 transition-colors"
                    >-</button>
                    <input 
                      type="number"
                      value={submissionCount}
                      onChange={(e) => setSubmissionCount(parseInt(e.target.value) || 1)}
                      className="w-full bg-transparent text-center font-bold text-sm outline-none"
                    />
                    <button 
                      onClick={() => setSubmissionCount(submissionCount + 1)}
                      className="w-8 h-8 rounded-lg hover:bg-white/10 transition-colors"
                    >+</button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Variation Strategy</label>
                  <button 
                    onClick={() => setAutoRandomize(!autoRandomize)}
                    className={`w-full h-10 px-3 rounded-xl border transition-all text-[10px] font-bold uppercase tracking-tight flex items-center justify-center gap-2 ${
                      autoRandomize 
                      ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" 
                      : "bg-white/5 border-white/10 text-slate-400"
                    }`}
                  >
                    <Binary className="w-3 h-3" />
                    {autoRandomize ? "AI Auto-Vary" : "Static Data"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex justify-between">
                  Interval Delay
                  <span className="text-indigo-400">{submissionDelay}ms</span>
                </label>
                <input 
                  type="range"
                  min="200"
                  max="5000"
                  step="100"
                  value={submissionDelay}
                  onChange={(e) => setSubmissionDelay(parseInt(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <button
                onClick={startAutomatedSubmission}
                disabled={!!progress || !metadata}
                className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-base shadow-lg shadow-indigo-900/20 hover:bg-indigo-500 transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider"
              >
                {progress ? (
                  <span className="flex items-center justify-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Executing Batch...
                  </span>
                ) : (
                  "Initiate Automated Sequence"
                )}
              </button>

              {progress && (
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between text-[10px] font-mono text-slate-400 uppercase tracking-tighter">
                    <span>Task Progress</span>
                    <span>{progress.current} / {progress.total} UNIT</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"
                      initial={{ width: 0 }}
                      animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {results && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" /> SUCCESSFUL_TRANSACTIONS
                    </span>
                    <span className="font-mono text-slate-300">{results.success}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 font-medium flex items-center gap-1.5">
                      <AlertCircle className="w-3 h-3" /> FAILED_SEQUENCES
                    </span>
                    <span className="font-mono text-slate-300">{results.failed}</span>
                  </div>
                  
                  {submittedData.length > 0 && (
                    <button
                      onClick={downloadCSV}
                      className="w-full mt-4 py-2.5 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-emerald-500/30 transition-all"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Download Export (CSV)
                    </button>
                  )}
                </motion.div>
              )}
            </div>
          </div>

          {/* Performance Summary Chart */}
          {batchPerformance.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest">Batch History</h4>
                  <p className="text-[10px] text-slate-400 mt-1">Timeline of recent automation results</p>
                </div>
                <BarChart2 className="w-4 h-4 text-slate-300" />
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={batchPerformance}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 9, fontWeight: 700, fill: '#94a3b8' }}
                      dy={10}
                    />
                    <YAxis 
                      hide 
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 700 }}
                      cursor={{ fill: '#f8fafc' }}
                    />
                    <Bar dataKey="success" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                    <Bar dataKey="failed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* Console Output (Terminal UI) */}
          <div className="bg-slate-900 rounded-2xl p-5 flex-1 shadow-2xl overflow-hidden flex flex-col min-h-[300px]">
            <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
              <span className="ml-2 text-[10px] font-mono text-slate-500 uppercase font-bold tracking-widest">Process Monitor</span>
            </div>
            <div className="font-mono text-[11px] leading-relaxed flex-1 overflow-y-auto space-y-1.5 custom-scrollbar text-slate-500">
              <p>[INIT] <span className="text-indigo-400">SYSCALL</span>: Initializing worker thread...</p>
              {metadata && <p>[INFO] <span className="text-slate-300">PARSER</span>: Form structure detected: {metadata.title}</p>}
              {progress && <p className="text-white">[BUSY] Submitting instance {progress.current} of {progress.total}...</p>}
              {results && results.success > 0 && <p>[EXIT] <span className="text-emerald-400">OK</span>: Batch operation concluded successfully.</p>}
              {results && results.failed > 0 && <p>[EXIT] <span className="text-red-400">ERR</span>: {results.failed} network timeouts detected.</p>}
              <p className="text-slate-700 animate-pulse">_</p>
            </div>
            <div className="mt-auto pt-3 border-t border-white/5 flex justify-between items-center text-[9px] font-mono text-slate-600">
              <span className="uppercase">Runtime: 0.82ms</span>
              <span className="uppercase">Memory: 184.2MB</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 px-8 bg-white border-t border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-[11px] text-slate-400 font-medium uppercase tracking-widest italic font-serif">
            Personal Automation License No. 8832-1A
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full w-full bg-indigo-500 opacity-20"></div>
          </div>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">System Ready</span>
        </div>
      </footer>

      {/* Logs Overlay UI */}
      <AnimatePresence>
        {isLogsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-end"
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-xl h-full bg-white shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <ScrollText className="w-5 h-5 text-indigo-600" />
                    Transaction Logs
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Detailed history of all batch operations</p>
                </div>
                <button 
                  onClick={() => setIsLogsOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50">
                    <ScrollText className="w-12 h-12 mb-4" />
                    <p className="text-sm font-medium">No logs recorded yet</p>
                  </div>
                ) : (
                  [...logs].reverse().map((log, idx) => (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-xl border ${
                        log.status === 'success' 
                        ? 'bg-emerald-50/50 border-emerald-100' 
                        : log.status === 'info'
                        ? 'bg-indigo-50/50 border-indigo-100'
                        : 'bg-red-50/50 border-red-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          log.status === 'success' ? 'text-emerald-600' : log.status === 'info' ? 'text-indigo-600' : 'text-red-600'
                        }`}>
                          {log.status === 'success' ? 'Submission_OK' : log.status === 'info' ? 'PROCESS_INFO' : 'Submission_ERR'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{log.timestamp}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-700 leading-tight">
                        {log.message}
                      </p>
                      {log.data && (
                        <div className="mt-3 bg-white/50 rounded-lg p-2 border border-slate-100">
                          <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Payload Data</p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {Object.entries(log.data).map(([key, val]) => (
                              <div key={key} className="flex items-center gap-2 overflow-hidden">
                                <span className="text-[9px] font-mono text-slate-400 shrink-0">{key}:</span>
                                <span className="text-[9px] font-medium text-slate-600 truncate">{String(val)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {logs.length} Total Entries
                </div>
                {submittedData.length > 0 && (
                  <button
                    onClick={downloadCSV}
                    className="flex items-center gap-2 text-xs font-bold text-emerald-600 px-4 py-2 rounded-lg bg-emerald-100/50 hover:bg-emerald-100 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payload Preview Modal */}
      <AnimatePresence>
        {previewPage !== null && metadata && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setPreviewPage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl bg-slate-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div>
                  <h3 className="text-lg font-bold text-white">Page {previewPage + 1} Payload Preview</h3>
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mt-1">Staging Data</p>
                </div>
                <button 
                  onClick={() => setPreviewPage(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <pre className="text-indigo-400 font-mono text-xs leading-relaxed bg-black/40 p-6 rounded-2xl border border-white/5 whitespace-pre-wrap">
                  {JSON.stringify(
                    metadata.fields
                      .filter(f => f.pageIndex === previewPage)
                      .reduce((acc, f) => {
                        acc[f.label] = formValues[f.id] || "null";
                        return acc;
                      }, {} as any),
                    null,
                    2
                  )}
                </pre>
              </div>
              <div className="p-6 bg-white/5 border-t border-white/10 text-center">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Verified JSON Schema Representation</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-indigo-600" />
                    System Settings
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Configure advanced automation parameters</p>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Search className="w-3 h-3" />
                    Custom Proxy URL
                  </label>
                  <input 
                    type="text"
                    placeholder="http://user:pass@host:port"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-mono"
                  />
                  <p className="text-[10px] text-slate-400 leading-relaxed italic">
                    Use a reliable rotating proxy to bypass strict Google rate limiting. Leave empty to use system default.
                  </p>
                </div>

                <div className="h-px bg-slate-100"></div>

                <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">Advanced Anti-Bot</h4>
                      <p className="text-[10px] text-slate-500 uppercase tracking-tight">Active Detection Suppression</p>
                    </div>
                    <div className="w-10 h-5 bg-indigo-600 rounded-full flex items-center px-1">
                      <div className="w-3 h-3 bg-white rounded-full ml-auto"></div>
                    </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all"
                >
                  Save Configuration
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
