import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { MRT_LINES } from './constants';
import { MRTLine, Station, VisitLog, VisitMap } from './types';

// --- CONFIG ---
// Ideally, put these in Vercel Environment Variables later!
// For now, you can hardcode them to test, or use import.meta.env
const CLOUDINARY_CLOUD_NAME = "dkzcaidam"; // <--- REPLACE THIS!
const CLOUDINARY_UPLOAD_PRESET = "mrt_photolog"; // <--- REPLACE THIS!

const getApiKey = (): string | undefined => {
  // @ts-ignore
  return import.meta.env.VITE_GOOGLE_API_KEY;
};

// --- HELPER: Upload to Cloudinary ---
const uploadImage = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!response.ok) throw new Error('Upload failed');
  const data = await response.json();
  return data.secure_url;
};

// --- HELPER: Resize Image URL ---
// Adds Cloudinary parameters to resize to 800px width (good for 16" screens)
const getOptimizedUrl = (url: string) => {
  if (!url || !url.includes('cloudinary.com')) return url;
  // Insert transformation: w_800 (width 800px), c_limit (don't upscale small images), q_auto (auto quality)
  const parts = url.split('/upload/');
  return `${parts[0]}/upload/w_800,c_limit,q_auto,f_auto/${parts[1]}`;
};

// --- Components ---

const LineHeader = ({ line, isExpanded, onClick, progress }: { line: MRTLine, isExpanded: boolean, onClick: () => void, progress: string }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between p-4 mb-2 rounded-xl shadow-sm transition-all duration-300 border border-stone-100 dark:border-stone-800
      ${isExpanded 
        ? 'bg-white dark:bg-stone-800 ring-2 ring-offset-2 ring-stone-200 dark:ring-offset-stone-900' 
        : 'bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700'
      }`}
  >
    <div className="flex items-center gap-4">
      <div className={`w-2 h-10 rounded-full ${line.colorClass}`} />
      <div className="text-left">
        <h3 className="font-bold text-lg text-stone-800 dark:text-stone-100">{line.name}</h3>
        <p className="text-xs font-medium text-stone-500 dark:text-stone-400 mt-0.5">{progress} Stations</p>
      </div>
    </div>
    <div className={`p-2 rounded-full bg-stone-50 dark:bg-stone-700 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
      <svg className="w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </button>
);

const StationBubble = ({ station, visit, line, onClick }: { station: Station, visit?: VisitLog, line: MRTLine, onClick: () => void }) => {
  const hasPhoto = !!visit?.imageData;
  // Use optimized URL if available
  const displayImage = hasPhoto ? getOptimizedUrl(visit!.imageData!) : '';

  return (
    <button 
      onClick={onClick}
      className={`relative group flex flex-col items-center justify-center aspect-square rounded-2xl overflow-hidden transition-all duration-300
        ${!visit 
          ? 'bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700' 
          : hasPhoto 
            ? 'bg-stone-900 ring-2 ring-offset-1 ring-transparent hover:ring-blue-400 dark:ring-offset-stone-900' 
            : `${line.colorClass} shadow-lg bg-opacity-90`
        }
      `}
    >
      {hasPhoto ? (
        <>
          <img src={displayImage} alt={station.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 opacity-60" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40" />
          <span className="absolute top-2 left-2 bg-black/40 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/10">
            {station.code}
          </span>
          <div className="absolute bottom-2 left-1 right-1 text-center">
            <p className="text-[10px] font-bold text-white leading-tight drop-shadow-md line-clamp-2">
              {station.name}
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center p-2 text-center w-full h-full">
          <span className={`text-sm font-black font-mono mb-1 ${visit ? 'text-white' : 'text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300'}`}>
            {station.code}
          </span>
          <span className={`text-[10px] font-medium leading-tight line-clamp-2 w-full ${visit ? 'text-white/90' : 'text-stone-500 dark:text-stone-600'}`}>
            {station.name}
          </span>
        </div>
      )}
    </button>
  );
};

// --- Main App ---

export default function App() {
  const [isDark, setIsDark] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<string | null>('EWL');
  const [visitMap, setVisitMap] = useState<VisitMap>({});
  const [selectedStationData, setSelectedStationData] = useState<{station: Station, line: MRTLine} | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Loading States
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);

  // Edit Form State
  const [tempVisit, setTempVisit] = useState<VisitLog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }

    try {
      const savedData = localStorage.getItem('sg_rail_journey_visits');
      if (savedData) {
        setVisitMap(JSON.parse(savedData));
      }
    } catch (e) {
      console.error("Error loading saved data", e);
    }
  }, []);

  const toggleTheme = () => {
    const newMode = !isDark;
    setIsDark(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleStationClick = (station: Station, line: MRTLine) => {
    setSelectedStationData({ station, line });
    const existing = visitMap[station.code];
    setTempVisit(existing ? { ...existing } : { 
      stationCode: station.code, 
      visitedDate: new Date().toISOString().split('T')[0] 
    });
    setIsModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tempVisit) return;

    // 1. Show local preview immediately (User feedback)
    const reader = new FileReader();
    reader.onload = (ev) => {
        setTempVisit(prev => prev ? { ...prev, imageData: ev.target?.result as string } : null);
    };
    reader.readAsDataURL(file);

    // 2. Upload to Cloudinary
    setIsUploading(true);
    try {
        const cloudUrl = await uploadImage(file);
        setTempVisit(prev => prev ? { ...prev, imageData: cloudUrl } : null);
        
        // 3. Generate Caption (Only after successful upload, using the file)
        // Note: We still use the local base64 for AI because it's faster than fetching the URL
        // But we SAVE the cloudUrl.
        generateCaption(file);

    } catch (err) {
        console.error("Upload failed", err);
        alert("Failed to upload image to cloud. Please try again.");
    } finally {
        setIsUploading(false);
    }
  };

  const generateCaption = async (file: File) => {
    const apiKey = getApiKey();
    if (!apiKey) return;

    setIsGeneratingCaption(true);
    try {
        // Convert file to base64 for Google AI
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: {
                    parts: [
                        { inlineData: { mimeType: file.type, data: base64 } },
                        { text: `Write a poetic, 1-sentence gratitude caption about this scene at ${selectedStationData?.station.name} MRT station.` }
                    ]
                }
            });
            setTempVisit(prev => prev ? { ...prev, caption: response.text.trim() } : null);
            setIsGeneratingCaption(false);
        };
    } catch (error) {
        console.error("AI Error:", error);
        setIsGeneratingCaption(false);
    }
  };

  const saveEntry = () => {
    if (!tempVisit) return;
    const newMap = { ...visitMap, [tempVisit.stationCode]: tempVisit };
    setVisitMap(newMap);
    localStorage.setItem('sg_rail_journey_visits', JSON.stringify(newMap));
    setIsModalOpen(false);
  };

  const deleteEntry = () => {
    if (!selectedStationData) return;
    const newMap = { ...visitMap };
    delete newMap[selectedStationData.station.code];
    setVisitMap(newMap);
    localStorage.setItem('sg_rail_journey_visits', JSON.stringify(newMap));
    setIsModalOpen(false);
  };

  const totalStations = MRT_LINES.reduce((sum, line) => sum + line.stations.length, 0);
  const totalVisited = Object.keys(visitMap).length;
  const progressPercent = totalStations > 0 ? Math.round((totalVisited / totalStations) * 100) : 0;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 transition-colors duration-300 font-sans">
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-stone-900/90 backdrop-blur-md border-b border-stone-200 dark:border-stone-800 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-red-600 text-white w-8 h-8 rounded-lg flex items-center justify-center font-bold shadow-red-500/20 shadow-lg">G</div>
            <span className="font-bold text-lg tracking-tight">Gratitude<span className="text-red-500">MRT</span></span>
          </div>
          <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors">
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="h-1 bg-stone-100 dark:bg-stone-800 w-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-red-500 via-purple-500 to-blue-500 transition-all duration-700 ease-out" style={{ width: `${progressPercent}%` }} />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 pb-32 space-y-8">
        <div className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-sm border border-stone-100 dark:border-stone-800 text-center">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-2">My Journey</h2>
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-purple-600">{totalVisited}</span>
            <span className="text-stone-500 font-medium">/ {totalStations} Stations</span>
          </div>
          <p className="text-sm text-stone-400 mt-2">{progressPercent}% of Singapore explored</p>
        </div>

        <div className="space-y-4">
          {MRT_LINES.map(line => {
            const lineVisited = line.stations.filter(s => visitMap[s.code]).length;
            const lineProgress = `${lineVisited}/${line.stations.length}`;
            return (
              <div key={line.id}>
                <LineHeader 
                  line={line} 
                  isExpanded={expandedLineId === line.id} 
                  onClick={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)} 
                  progress={lineProgress} 
                />
                <div className={`grid grid-cols-4 sm:grid-cols-5 gap-3 overflow-hidden transition-all duration-500 ease-in-out px-1 ${expandedLineId === line.id ? 'max-h-[3000px] opacity-100 py-2' : 'max-h-0 opacity-0'}`}>
                  {line.stations.map(station => (
                    <StationBubble key={station.code} station={station} line={line} visit={visitMap[station.code]} onClick={() => handleStationClick(station, line)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {isModalOpen && selectedStationData && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setIsModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full sm:max-w-lg bg-white dark:bg-stone-950 rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-up">
            <div className="p-6 pb-4 border-b border-stone-100 dark:border-stone-900 sticky top-0 bg-white/95 dark:bg-stone-950/95 backdrop-blur z-10 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2 text-stone-900 dark:text-white">
                  <span className={`px-2 py-0.5 rounded text-sm text-white ${selectedStationData.line.colorClass}`}>{selectedStationData.station.code}</span>
                  {selectedStationData.station.name}
                </h2>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">{selectedStationData.line.name}</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="p-2 bg-stone-100 dark:bg-stone-800 rounded-full hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"><svg className="w-5 h-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <div className="p-6 space-y-6">
              <div onClick={() => fileInputRef.current?.click()} className={`group relative aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer overflow-hidden transition-all ${tempVisit?.imageData ? 'border-transparent bg-black' : 'border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-stone-800'}`}>
                {tempVisit?.imageData ? (
                  <>
                    <img src={getOptimizedUrl(tempVisit.imageData)} alt="Memory" className="w-full h-full object-contain" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-medium backdrop-blur-sm">
                      <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      Change Photo
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 bg-white dark:bg-stone-800 rounded-full flex items-center justify-center mb-3 shadow-sm group-hover:scale-110 transition-transform"><span className="text-2xl">📸</span></div>
                    <p className="text-sm font-medium text-stone-600 dark:text-stone-400">Add a memory</p>
                    <p className="text-xs text-stone-400 mt-1">Click to upload photo</p>
                  </>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                {isUploading && <div className="absolute inset-0 bg-white/80 dark:bg-black/80 flex items-center justify-center text-sm font-bold text-blue-500 animate-pulse">Uploading to Cloud...</div>}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 block">Date</label>
                  <input type="date" value={tempVisit?.visitedDate || ''} onChange={e => setTempVisit(prev => prev ? { ...prev, visitedDate: e.target.value } : null)} className="w-full p-3 bg-stone-50 dark:bg-stone-900 rounded-xl border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-black focus:ring-0 transition-colors text-stone-900 dark:text-stone-100 outline-none" />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-bold text-stone-500 uppercase tracking-wider">Gratitude Caption</label>
                    {isGeneratingCaption && <span className="text-xs font-medium text-blue-500 animate-pulse flex items-center gap-1">✨ AI Generating...</span>}
                  </div>
                  <textarea value={tempVisit?.caption || ''} onChange={e => setTempVisit(prev => prev ? { ...prev, caption: e.target.value } : null)} placeholder="What are you grateful for?" rows={3} className="w-full p-3 bg-stone-50 dark:bg-stone-900 rounded-xl border border-transparent focus:border-blue-500 focus:bg-white dark:focus:bg-black focus:ring-0 transition-colors text-stone-900 dark:text-stone-100 outline-none resize-none" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 block">Highlights ✨</label><input value={tempVisit?.highlights || ''} onChange={e => setTempVisit(prev => prev ? { ...prev, highlights: e.target.value } : null)} className="w-full p-3 bg-stone-50 dark:bg-stone-900 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500/20 text-stone-900 dark:text-stone-100" /></div>
                  <div><label className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1.5 block">Good Food 🍜</label><input value={tempVisit?.goodFood || ''} onChange={e => setTempVisit(prev => prev ? { ...prev, goodFood: e.target.value } : null)} className="w-full p-3 bg-stone-50 dark:bg-stone-900 rounded-xl outline-none text-sm focus:ring-2 focus:ring-blue-500/20 text-stone-900 dark:text-stone-100" /></div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-stone-100 dark:border-stone-800">
                <button onClick={deleteEntry} className="flex-1 py-3.5 px-6 rounded-xl text-red-500 font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">Clear Entry</button>
                <button onClick={saveEntry} disabled={isUploading} className={`flex-[2] py-3.5 px-6 rounded-xl text-white font-bold shadow-lg transition-opacity text-sm ${isUploading ? 'bg-stone-400 cursor-not-allowed' : 'bg-stone-900 dark:bg-white dark:text-black hover:opacity-90 shadow-black/10'}`}>{isUploading ? 'Uploading...' : 'Save Journey'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
