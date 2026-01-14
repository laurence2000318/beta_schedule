
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { 
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis
} from 'recharts';
import { DiffusionParams, ScheduleType, TimestepData, ComparisonItem } from './types';
import { calculateSchedule, downloadCSV, solveBetaEndForSNR } from './diffusionUtils';

type ConfigMode = 'manual' | 'solver' | 'custom';

/**
 * ZoomableChartContainer: Handles the interactive zooming and panning for the enlarged view.
 * Ensures axes remain visible while the viewport shifts.
 */
const ZoomableChartContainer = ({ 
  children, 
  initialNumSteps, 
  initialBetaStart,
  isBetaChart,
  yPrecision
}: { 
  children: (props: { xDomain: [number, number], yDomain: [number | string, number | string] }) => React.ReactNode, 
  initialNumSteps: number, 
  initialBetaStart: number,
  isBetaChart: boolean,
  yPrecision: number
}) => {
  const [xDomain, setXDomain] = useState<[number, number]>([0, initialNumSteps]);
  const [yDomain, setYDomain] = useState<[number | string, number | string]>(['auto', 'auto']);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
    
    // Zoom X
    const [xMin, xMax] = xDomain;
    const xRange = xMax - xMin;
    const newXRange = xRange * zoomFactor;
    if (newXRange > 1) {
       const xCenter = (xMin + xMax) / 2;
       setXDomain([Math.max(0, xCenter - newXRange / 2), xCenter + newXRange / 2]);
    }
    
    // Y Zooming is disabled to keep context of scale, but we could enable it similarly 
    // if users specifically wanted to zoom the variance magnitude.
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsPanning(true);
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - lastPos.x;
    const rangeX = xDomain[1] - xDomain[0];
    const shiftX = (dx / 1000) * rangeX; 
    setXDomain([xDomain[0] - shiftX, xDomain[1] - shiftX]);
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsPanning(false);

  const reset = () => {
    setXDomain([0, initialNumSteps]);
    setYDomain(['auto', 'auto']);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-6 px-4">
        <div className="flex gap-4 items-center">
           <span className="text-xs font-black text-slate-500 uppercase bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 flex items-center gap-2">
            <i className="fas fa-arrows-alt text-indigo-500"></i>
            Scroll: Zoom Timesteps • Drag: Pan View • Double Click: Reset
          </span>
        </div>
        <button onClick={reset} className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all shadow-lg active:scale-95">
          RESET SCALE
        </button>
      </div>
      <div 
        className="flex-1 w-full bg-slate-50 rounded-[3rem] border-4 border-slate-100 overflow-hidden relative cursor-move select-none"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={reset}
      >
        {children({ xDomain, yDomain })}
      </div>
    </div>
  );
};

const Modal = ({ children, onClose }: { children?: React.ReactNode, onClose: () => void }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-sm" onClick={onClose}>
    <div className="bg-white rounded-[3.5rem] w-full max-w-screen-2xl h-[92vh] p-12 shadow-2xl relative flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
      <button onClick={onClose} className="absolute top-12 right-12 text-slate-300 hover:text-slate-900 transition-colors p-2 z-20">
        <i className="fas fa-times fa-4x"></i>
      </button>
      <div className="flex-1 min-h-0 w-full h-full">
        {children}
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [params, setParams] = useState({
    betaStart: "0.0001",
    betaEnd: "0.02",
    numTimesteps: "1000",
    schedule: ScheduleType.LINEAR
  });

  const [targetSnrDb, setTargetSnrDb] = useState<string>("-20");
  const [solverParams, setSolverParams] = useState({
    betaStart: "0.0001",
    numTimesteps: "1000"
  });
  const [solvedBetaEnds, setSolvedBetaEnds] = useState<Record<string, number>>({});

  const [customItems, setCustomItems] = useState<ComparisonItem[]>([
    { id: '1', label: 'Linear Baseline', schedule: ScheduleType.LINEAR, betaStart: 0.0001, betaEnd: 0.02, numTimesteps: 1000 },
    { id: '2', label: 'Exp Growth', schedule: ScheduleType.EXP, betaStart: 0.0001, betaEnd: 0.035, numTimesteps: 1000 }
  ]);

  const [configMode, setConfigMode] = useState<ConfigMode>('manual');
  const [activeTab, setActiveTab] = useState<'charts' | 'table' | 'comparison'>('charts');
  const [enlargedKey, setEnlargedKey] = useState<string | null>(null);
  const [hoverData, setHoverData] = useState<any>(null);

  const numericParams = useMemo(() => ({
    betaStart: parseFloat(params.betaStart) || 0.0001,
    betaEnd: parseFloat(params.betaEnd) || 0.02,
    numTimesteps: Math.max(1, parseInt(params.numTimesteps) || 1000),
    schedule: params.schedule
  }), [params]);

  const scheduleData = useMemo(() => calculateSchedule(numericParams), [numericParams]);

  const comparativeResults = useMemo(() => {
    if (configMode === 'custom') {
      return customItems.map(item => ({
        label: item.label,
        id: item.id,
        data: calculateSchedule(item)
      }));
    } else if (configMode === 'solver' && Object.keys(solvedBetaEnds).length > 0) {
      return Object.values(ScheduleType).map(type => ({
        label: type.toUpperCase(),
        id: type,
        data: calculateSchedule({
          betaStart: parseFloat(solverParams.betaStart) || 0.0001,
          numTimesteps: parseInt(solverParams.numTimesteps) || 1000,
          betaEnd: solvedBetaEnds[type] || 0.02,
          schedule: type
        })
      }));
    } else {
      return Object.values(ScheduleType).map(type => ({
        label: type.toUpperCase(),
        id: type,
        data: calculateSchedule({ ...numericParams, schedule: type })
      }));
    }
  }, [configMode, numericParams, solvedBetaEnds, solverParams, customItems]);

  const comparativeScatterData = useMemo(() => {
    return comparativeResults.map(res => {
      const step = Math.max(1, Math.ceil(res.data.length / 250));
      return {
        id: res.id,
        label: res.label,
        points: res.data.filter((_, i) => i % step === 0)
      };
    });
  }, [comparativeResults]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setParams(prev => ({ ...prev, [name]: value }));
  };

  const runGlobalSolver = () => {
    const snr = parseFloat(targetSnrDb);
    const results: Record<string, number> = {};
    Object.values(ScheduleType).forEach(type => {
      results[type] = solveBetaEndForSNR(snr, parseFloat(solverParams.betaStart) || 0.0001, parseInt(solverParams.numTimesteps) || 1000, type);
    });
    setSolvedBetaEnds(results);
  };

  const addCustomItem = () => {
    setCustomItems([...customItems, {
      id: Math.random().toString(36).substr(2, 9),
      label: `${params.schedule.toUpperCase()} (T:${params.numTimesteps})`,
      ...numericParams
    }]);
  };

  const handleMouseMove = useCallback((state: any) => {
    if (state && state.activePayload && state.activePayload.length > 0) {
      const t = Math.round(state.activePayload[0].payload.t);
      const values: any = { t };
      comparativeResults.forEach(res => {
        const point = res.data[t - 1] || res.data.find(d => d.t === t);
        if (point) values[res.label] = point;
      });
      setHoverData(values);
    }
  }, [comparativeResults]);

  const scheduleColors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6', '#f43f5e', '#a855f7'];

  // Calculate required precision for Y Axis based on betaStart
  const yPrecision = useMemo(() => {
    const mag = Math.floor(Math.log10(numericParams.betaStart));
    return Math.max(2, Math.abs(mag) + 1);
  }, [numericParams.betaStart]);

  return (
    <div className="flex flex-col min-h-screen text-lg font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,400..700;1,400..700&display=swap');
        
        .math-container {
          font-family: 'Lora', serif;
          line-height: 1.6;
        }
        .math-symbol {
          font-style: italic;
          color: #818cf8;
          font-weight: 600;
          margin-right: 0.15rem;
        }
        .math-formula {
          background: rgba(255, 255, 255, 0.02);
          padding: 1.25rem;
          border-radius: 1.25rem;
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: block;
          margin: 0.75rem 0;
          font-size: 1.1rem;
        }
        .math-label {
          color: #94a3b8;
          font-size: 0.65rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          margin-bottom: 0.5rem;
          display: block;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .recharts-cartesian-axis-tick-value {
          font-weight: 800;
          fill: #475569;
          font-size: 12px;
        }
        .recharts-legend-item-text {
          font-weight: 900 !important;
          color: #1e293b !important;
        }
      `}</style>

      {enlargedKey && (
        <Modal onClose={() => setEnlargedKey(null)}>
           <div className="h-full flex flex-col">
             <div className="flex items-center gap-6 mb-10">
                <div className="w-4 h-12 bg-indigo-600 rounded-full"></div>
                <h2 className="text-5xl font-black text-slate-900 tracking-tighter">{enlargedKey}</h2>
             </div>
             <ZoomableChartContainer 
               initialNumSteps={numericParams.numTimesteps} 
               initialBetaStart={numericParams.betaStart}
               isBetaChart={enlargedKey.includes("Beta")}
               yPrecision={yPrecision}
             >
               {({ xDomain, yDomain }) => (
                 <ResponsiveContainer width="100%" height="100%">
                    {enlargedKey.includes("Comparison") ? (
                      <ScatterChart margin={{ top: 20, right: 60, left: 40, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                          type="number" 
                          dataKey="t" 
                          domain={xDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => Math.round(v).toString()}
                          allowDataOverflow 
                          label={{ value: 'Timestep (t)', position: 'bottom', offset: 40, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                          tick={{ fontSize: 14 }}
                        />
                        <YAxis 
                          type="number" 
                          dataKey={enlargedKey.includes("Beta") ? "beta" : "snrDb"} 
                          domain={yDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => v.toFixed(enlargedKey.includes("Beta") ? yPrecision : 1)}
                          allowDataOverflow 
                          label={{ value: enlargedKey.includes("Beta") ? 'β (Variance)' : 'SNR (dB)', angle: -90, position: 'left', offset: -10, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                          tick={{ fontSize: 14 }}
                        />
                        <ZAxis range={[70, 70]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Legend verticalAlign="top" height={100} iconType="circle" wrapperStyle={{fontSize: 18, fontWeight: 900, paddingBottom: '20px'}}/>
                        {comparativeScatterData.map((series, i) => (
                          <Scatter 
                            key={series.id} 
                            name={series.label} 
                            data={series.points} 
                            fill={scheduleColors[i % scheduleColors.length]} 
                            line={{ stroke: scheduleColors[i % scheduleColors.length], strokeWidth: 5 }}
                          />
                        ))}
                      </ScatterChart>
                    ) : (
                      <ScatterChart margin={{ top: 20, right: 60, left: 40, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                          type="number" 
                          dataKey="t" 
                          domain={xDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => Math.round(v).toString()}
                          allowDataOverflow 
                          label={{ value: 'Timestep (t)', position: 'bottom', offset: 40, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                        />
                        <YAxis 
                          type="number" 
                          dataKey={enlargedKey.toLowerCase().includes("beta") ? "beta" : enlargedKey.toLowerCase().includes("snr") ? "snrDb" : "alphaBar"} 
                          domain={yDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => v.toFixed(enlargedKey.includes("Beta") ? yPrecision : 4)}
                          allowDataOverflow 
                          tick={{ fontSize: 14 }}
                        />
                        <ZAxis range={[120, 120]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter 
                          name={enlargedKey} 
                          data={scheduleData.filter((_, i) => i % Math.max(1, Math.ceil(scheduleData.length / 600)) === 0)} 
                          fill="#6366f1" 
                          line={{ stroke: "#6366f1", strokeWidth: 6 }}
                        />
                      </ScatterChart>
                    )}
                 </ResponsiveContainer>
               )}
             </ZoomableChartContainer>
           </div>
        </Modal>
      )}

      <header className="bg-white border-b border-slate-200 py-10 px-14 sticky top-0 z-30 shadow-sm backdrop-blur-xl bg-white/95">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="bg-indigo-600 p-6 rounded-[2.5rem] text-white shadow-2xl shadow-indigo-200 transform hover:scale-105 transition-transform">
              <i className="fas fa-microchip fa-4xl"></i>
            </div>
            <div>
              <h1 className="text-5xl font-black text-slate-900 tracking-tighter leading-none">Diffusion Engine</h1>
              <p className="text-base text-slate-400 font-black uppercase tracking-[0.4em] mt-4">Noise Schedule Analyzer v3.0</p>
            </div>
          </div>
          <button onClick={() => downloadCSV(scheduleData)} className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] text-sm font-black shadow-2xl hover:bg-black transition-all flex items-center gap-5 active:scale-95">
            <i className="fas fa-file-export"></i> EXPORT CSV
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl mx-auto w-full p-10 md:p-14 grid grid-cols-1 lg:grid-cols-4 gap-14">
        
        <aside className="lg:col-span-1 space-y-12">
          <div className="bg-white rounded-[3.5rem] shadow-2xl shadow-slate-200 border border-slate-100 overflow-hidden">
            <div className="flex bg-slate-50 border-b border-slate-100 p-4">
              {(['manual', 'solver', 'custom'] as ConfigMode[]).map(mode => (
                <button 
                  key={mode} 
                  onClick={() => setConfigMode(mode)}
                  className={`flex-1 py-4 text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all ${configMode === mode ? 'text-indigo-600 bg-white shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <div className="p-12">
              {configMode === 'manual' && (
                <div className="space-y-10">
                  <h3 className="text-xs font-black text-slate-300 uppercase tracking-[0.4em]">Configuration</h3>
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Growth Function</label>
                    <select name="schedule" value={params.schedule} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-xl font-bold outline-none focus:border-indigo-500 transition-colors">
                      {Object.values(ScheduleType).map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                    </select>
                  </div>
                  {params.schedule === ScheduleType.CONST ? (
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Value (β)</label>
                      <input type="text" name="betaEnd" value={params.betaEnd} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black text-indigo-600" />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Initial Variance (β₀)</label>
                        <input type="text" name="betaStart" value={params.betaStart} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Final Variance (βₙ)</label>
                        <input type="text" name="betaEnd" value={params.betaEnd} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black" />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Timesteps (T)</label>
                    <input type="text" name="numTimesteps" value={params.numTimesteps} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black" />
                  </div>
                </div>
              )}

              {configMode === 'solver' && (
                <div className="space-y-10">
                  <h3 className="text-xs font-black text-slate-300 uppercase tracking-[0.4em]">Optimization</h3>
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Target SNR (dB) @ T</label>
                    <input 
                      type="text" 
                      value={targetSnrDb} 
                      onChange={(e) => setTargetSnrDb(e.target.value)} 
                      className="w-full bg-indigo-50 border-2 border-indigo-100 rounded-3xl px-8 py-6 text-3xl font-black text-indigo-600 outline-none" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Base β₀</label>
                      <input type="text" value={solverParams.betaStart} onChange={(e) => setSolverParams({...solverParams, betaStart: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 text-sm font-mono font-black" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Steps T</label>
                      <input type="text" value={solverParams.numTimesteps} onChange={(e) => setSolverParams({...solverParams, numTimesteps: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 text-sm font-mono font-black" />
                    </div>
                  </div>
                  <button onClick={runGlobalSolver} className="w-full py-7 bg-indigo-600 text-white rounded-[2.5rem] text-sm font-black shadow-2xl hover:bg-indigo-700 transition-all uppercase tracking-widest active:scale-95">CALCULATE OPTIMAL βₙ</button>
                </div>
              )}

              {configMode === 'custom' && (
                <div className="space-y-10">
                   <h3 className="text-xs font-black text-slate-300 uppercase tracking-[0.4em]">Comparison</h3>
                  <div className="bg-slate-50 rounded-[2.5rem] p-10 border border-slate-100 space-y-6">
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest">Strategy</label>
                      <select name="schedule" value={params.schedule} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold outline-none">
                        {Object.values(ScheduleType).map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                      </select>
                    </div>
                    {params.schedule !== ScheduleType.CONST && (
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest">Start β₀</label>
                        <input type="text" name="betaStart" value={params.betaStart} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm font-mono font-bold" />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest">End βₙ</label>
                      <input type="text" name="betaEnd" value={params.betaEnd} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm font-mono font-bold" />
                    </div>
                    <button onClick={addCustomItem} className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[11px] font-black hover:bg-black transition-all shadow-xl">ADD TO BENCHMARK</button>
                  </div>
                  <div className="space-y-5 max-h-72 overflow-y-auto pr-4 custom-scrollbar">
                    {customItems.map((item) => (
                      <div key={item.id} className="p-6 bg-white border border-slate-200 rounded-3xl relative group shadow-sm hover:border-indigo-300 transition-all">
                        <button onClick={() => setCustomItems(customItems.filter(ci => ci.id !== item.id))} className="absolute top-6 right-6 text-slate-300 hover:text-red-500 transition-colors">
                          <i className="fas fa-trash-alt text-base"></i>
                        </button>
                        <div className="text-xs font-black text-slate-900 uppercase mb-4 truncate pr-10">{item.label}</div>
                        <div className="flex gap-4">
                          <span className="bg-slate-100 px-4 py-1.5 rounded-full text-[9px] font-black text-slate-500 uppercase">{item.schedule}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-900 rounded-[3.5rem] p-12 text-white shadow-2xl math-container">
            <h3 className="font-black text-xl mb-10 border-b border-white/10 pb-6 flex items-center gap-5 uppercase tracking-[0.2em] text-indigo-400">Math Reference</h3>
            <ul className="space-y-12">
              <li>
                <span className="math-label">Retention Factor</span>
                <span className="math-formula">
                  <span className="math-symbol">αₜ</span> = 1 − <span className="math-symbol">βₜ</span>
                </span>
              </li>
              <li>
                <span className="math-label">Cumulative Product</span>
                <span className="math-formula">
                  <span className="math-symbol">ᾱₜ</span> = Π<span className="math-symbol">ₛ₌₁ᵗ αₛ</span>
                </span>
              </li>
              <li>
                <span className="math-label">Noise Distribution (q)</span>
                <span className="math-formula">
                   q(xₜ|x₀) = 𝒩(xₜ; <span className="math-symbol">sqrt(ᾱₜ)</span>x₀, (1 − <span className="math-symbol">ᾱₜ</span>)𝐈)
                </span>
              </li>
              <li>
                <span className="math-label">Signal-to-Noise Ratio</span>
                <span className="math-formula">
                  <span className="math-symbol">SNR</span> = <span className="math-symbol">ᾱₜ</span> / (1 − <span className="math-symbol">ᾱₜ</span>)
                  <span className="block text-[11px] font-black text-indigo-400 mt-4 tracking-widest uppercase">SNR(dB) = 10 · log₁₀(SNR)</span>
                </span>
              </li>
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-3 space-y-14">
          <nav className="flex bg-slate-200/50 p-3 rounded-[3rem] w-fit border border-slate-200 shadow-inner backdrop-blur-lg">
            <button onClick={() => setActiveTab('charts')} className={`px-14 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'charts' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>VISUALIZATION</button>
            <button onClick={() => setActiveTab('comparison')} className={`px-14 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'comparison' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>BENCHMARK</button>
            <button onClick={() => setActiveTab('table')} className={`px-14 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'table' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>DATA GRID</button>
          </nav>

          {activeTab === 'charts' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <ChartCard title="Beta Variance Profile (βₜ)" data={scheduleData} dataKey="beta" color="#6366f1" onEnlarge={() => setEnlargedKey('Beta Variance Profile (βₜ)')} yPrecision={yPrecision} />
              <ChartCard title="SNR Decay Curve (dB)" data={scheduleData} dataKey="snrDb" color="#f59e0b" suffix=" dB" onEnlarge={() => setEnlargedKey('SNR Decay Curve (dB)')} />
              <ChartCard title="Scaling Factors (q)" data={scheduleData} dataKeys={['sqrtAlphaBar', 'sqrtOneMinusAlphaBar']} names={['sqrt(ᾱₜ)', 'sqrt(1−ᾱₜ)']} color="#ec4899" onEnlarge={() => setEnlargedKey('Scaling Factors (q)')} />
              <ChartCard title="Signal Maintenance (ᾱₜ)" data={scheduleData} dataKey="alphaBar" color="#8b5cf6" onEnlarge={() => setEnlargedKey('Signal Maintenance (ᾱₜ)')} />
            </div>
          )}

          {activeTab === 'comparison' && (
            <div className="space-y-14 animate-in fade-in slide-in-from-bottom-5 duration-700">
              <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 p-14 relative overflow-hidden h-[820px]">
                <div className="flex justify-between items-center mb-12">
                  <div className="space-y-3">
                    <h3 className="text-4xl font-black text-slate-900 flex items-center gap-6 tracking-tighter">Variance Benchmark (βₜ)</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Interactive Multi-Schedule Analysis</p>
                  </div>
                  <button onClick={() => setEnlargedKey('Comparison: Beta (βₜ)')} className="text-slate-200 hover:text-indigo-600 transition-colors p-4"><i className="fas fa-expand-arrows-alt fa-3x"></i></button>
                </div>
                <div className="h-[460px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 30 }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverData(null)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" dataKey="t" tick={{fontSize: 13, fontWeight: 900}} stroke="#cbd5e1" />
                      <YAxis type="number" dataKey="beta" tick={{fontSize: 13, fontWeight: 900}} stroke="#cbd5e1" tickFormatter={(v) => v.toFixed(yPrecision)} />
                      <ZAxis range={[60, 60]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '60px', fontSize: '15px', fontWeight: 900 }} />
                      {comparativeScatterData.map((res, i) => (
                        <Scatter 
                          key={res.id} 
                          name={res.label} 
                          data={res.points} 
                          fill={scheduleColors[i % scheduleColors.length]} 
                          line={{ stroke: scheduleColors[i % scheduleColors.length], strokeWidth: 5 }}
                          shape="circle" 
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                
                {hoverData && (
                  <div className="absolute top-32 right-14 bottom-32 w-[460px] bg-slate-950 text-white p-12 rounded-[4rem] shadow-3xl z-40 border border-white/5 overflow-y-auto custom-scrollbar shadow-indigo-500/10">
                    <div className="flex justify-between items-center mb-10 border-b border-white/5 pb-8">
                      <span className="text-xs font-black uppercase tracking-[0.4em] text-indigo-400">Step Insight</span>
                      <span className="bg-indigo-600 px-8 py-3 rounded-2xl text-lg font-black tracking-tighter shadow-xl">T = {hoverData.t}</span>
                    </div>
                    <div className="flex flex-col gap-6">
                      {Object.entries(hoverData).map(([name, data]: [string, any]) => {
                        if (name === 't') return null;
                        return (
                          <div key={name} className="flex flex-col gap-3 bg-white/5 p-8 rounded-[2.5rem] border border-white/5 hover:bg-white/10 transition-colors">
                            <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] truncate">{name}</span>
                            <div className="flex justify-between items-end">
                              <span className="font-mono text-2xl font-black text-indigo-300">{(data.beta as number).toExponential(yPrecision > 4 ? yPrecision : 4)}</span>
                              <span className="font-mono text-sm font-bold text-amber-500">{(data.snrDb as number).toFixed(2)} dB</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 p-14 relative overflow-hidden h-[650px]">
                <div className="flex justify-between items-center mb-12">
                  <div className="space-y-3">
                    <h3 className="text-4xl font-black text-slate-900 flex items-center gap-6 tracking-tighter">SNR dB Comparison</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Quality Persistence Analysis</p>
                  </div>
                  <button onClick={() => setEnlargedKey('Comparison: SNR (dB)')} className="text-slate-200 hover:text-indigo-600 transition-colors p-4"><i className="fas fa-expand-arrows-alt fa-3x"></i></button>
                </div>
                <div className="h-[440px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 30 }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverData(null)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" dataKey="t" tick={{fontSize: 13, fontWeight: 900}} stroke="#cbd5e1" />
                      <YAxis type="number" dataKey="snrDb" tick={{fontSize: 13, fontWeight: 900}} stroke="#cbd5e1" domain={['auto', 'auto']} />
                      <ZAxis range={[60, 60]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '60px', fontSize: '15px', fontWeight: 900 }} />
                      {comparativeScatterData.map((res, i) => (
                        <Scatter 
                          key={`${res.id}_snr`} 
                          name={`${res.label}`} 
                          data={res.points} 
                          fill={scheduleColors[i % scheduleColors.length]} 
                          line={{ stroke: scheduleColors[i % scheduleColors.length], strokeWidth: 5 }}
                          shape="circle"
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'table' && (
            <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in duration-700">
              <div className="overflow-x-auto max-h-[900px] custom-scrollbar">
                <table className="w-full text-left text-base font-medium border-collapse">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Step t</th>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Beta βₜ</th>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Alpha ᾱₜ</th>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Residual 1−ᾱₜ</th>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Factor sqrt(ᾱₜ)</th>
                      <th className="px-14 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">SNR (dB)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-center">
                    {scheduleData.filter((_, i) => i % (numericParams.numTimesteps > 1000 ? 50 : 1) === 0).map((row) => (
                      <tr key={row.t} className="hover:bg-indigo-50/50 transition-colors group">
                        <td className="px-14 py-8 font-mono text-sm text-slate-400 group-hover:text-indigo-600 font-bold">{row.t}</td>
                        <td className="px-14 py-8 font-mono text-sm font-black text-indigo-600">{row.beta.toExponential(yPrecision + 2)}</td>
                        <td className="px-14 py-8 font-mono text-sm">{row.alphaBar.toFixed(8)}</td>
                        <td className="px-14 py-8 font-mono text-sm">{row.oneMinusAlphaBar.toFixed(8)}</td>
                        <td className="px-14 py-8 font-mono text-sm">{row.sqrtAlphaBar.toFixed(8)}</td>
                        <td className="px-14 py-8 font-mono text-sm text-amber-600 font-black">{row.snrDb.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-32 px-14 mt-32 text-center text-slate-400 text-xs uppercase font-black tracking-[1em]">
        <div className="max-w-screen-2xl mx-auto flex flex-col items-center gap-14">
           <div className="flex gap-24 opacity-10 grayscale transition-all hover:grayscale-0 hover:opacity-100 cursor-default">
             <i className="fas fa-microchip fa-5x"></i>
             <i className="fas fa-atom fa-5x"></i>
             <i className="fas fa-project-diagram fa-5x"></i>
           </div>
          <p>© 2024 Visual Diffusion Dynamics • Advanced Optimization Core</p>
        </div>
      </footer>
    </div>
  );
};

interface ChartCardProps {
  title: string;
  data: TimestepData[];
  dataKey?: keyof TimestepData;
  dataKeys?: (keyof TimestepData)[];
  names?: string[];
  color: string;
  suffix?: string;
  onEnlarge?: () => void;
  yPrecision?: number;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, data, dataKey, dataKeys, names, color, suffix = "", onEnlarge, yPrecision = 4 }) => {
  const chartPoints = useMemo(() => {
    if (!data || data.length === 0) return [];
    const step = Math.max(1, Math.ceil(data.length / 150));
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const colors = ['#ec4899', '#8b5cf6', '#f59e0b', '#10b981'];

  return (
    <div className="bg-white rounded-[3.5rem] shadow-xl border border-slate-100 p-14 relative group transition-all hover:border-indigo-300 hover:shadow-2xl hover:scale-[1.03]">
      <div className="flex justify-between items-center mb-10">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-[0.3em]">{title}</h3>
        {onEnlarge && (
          <button onClick={onEnlarge} className="text-slate-200 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100 p-3">
            <i className="fas fa-expand-alt fa-2x"></i>
          </button>
        )}
      </div>
      <div className="h-80 w-full">
        {chartPoints.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 5, right: 15, left: -25, bottom: 5 }} data={chartPoints}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
              <XAxis type="number" dataKey="t" tick={{fontSize: 12, fontWeight: 900}} stroke="#cbd5e1" />
              <YAxis 
                type="number" 
                dataKey={dataKey ? (dataKey as string) : (dataKeys ? undefined : "val")} 
                tick={{fontSize: 12, fontWeight: 900}} 
                stroke="#cbd5e1" 
                domain={['auto', 'auto']} 
                tickFormatter={(v) => v.toFixed(dataKey === 'beta' ? yPrecision : 4)}
              />
              <ZAxis range={[50, 50]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(value: any) => [typeof value === 'number' ? value.toExponential(4) + suffix : value, '']} />
              
              {dataKey ? (
                <Scatter name={title} data={chartPoints} fill={color} line={{ stroke: color, strokeWidth: 5 }} shape="circle" />
              ) : dataKeys?.map((key, i) => (
                <Scatter key={key as string} name={names?.[i] || (key as string)} data={chartPoints.map(p => ({ t: p.t, val: (p as any)[key] }))} fill={colors[i % colors.length]} line={{ stroke: colors[i % colors.length], strokeWidth: 5 }} dataKey="val" />
              ))}
              
              {names && <Legend wrapperStyle={{ fontSize: '13px', fontWeight: 900, paddingTop: '40px' }} />}
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-300 text-xs font-black uppercase tracking-widest">Processing Data...</div>
        )}
      </div>
    </div>
  );
};

export default App;
