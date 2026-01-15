
import React, { useState, useMemo, useCallback } from 'react';
import { 
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ZAxis
} from 'recharts';
import { ScheduleType, TimestepData, ComparisonItem } from './types';
import { calculateSchedule, downloadCSV, solveBetaEndForSNR } from './diffusionUtils';

type ConfigMode = 'manual' | 'solver' | 'custom';

/**
 * ZoomableChartContainer: Handles interactive zooming and panning.
 * Optimized for high-precision axes display with data padding.
 */
const ZoomableChartContainer = ({ 
  children, 
  initialNumSteps, 
  isBetaType
}: { 
  children: (props: { xDomain: [number, number], yDomain: [number | string, number | string] }) => React.ReactNode, 
  initialNumSteps: number, 
  isBetaType: boolean 
}) => {
  // Use slightly padded initial domain for better visualization
  const [xDomain, setXDomain] = useState<[number, number]>([0, initialNumSteps]);
  const [yDomain, setYDomain] = useState<[number | string, number | string]>(['auto', 'auto']);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  // Update xDomain if initialNumSteps changes (e.g. Solver T update)
  React.useEffect(() => {
    setXDomain([0, initialNumSteps]);
  }, [initialNumSteps]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    
    // X Axis Zoom
    const [xMin, xMax] = xDomain;
    const xRange = xMax - xMin;
    const newXRange = xRange * zoomFactor;
    if (newXRange > 2) {
       const xCenter = (xMin + xMax) / 2;
       setXDomain([Math.max(-initialNumSteps * 0.1, xCenter - newXRange / 2), xCenter + newXRange / 2]);
    }
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
           <span className="text-[10px] font-black text-slate-500 uppercase bg-slate-100 px-4 py-2 rounded-xl border border-slate-200 flex items-center gap-2 tracking-widest">
            <i className="fas fa-search-plus text-indigo-500"></i>
            Scroll: Zoom Timesteps • Drag: Pan • Double Click: Reset
          </span>
        </div>
        <button onClick={reset} className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 transition-all shadow-lg active:scale-95">
          RESET AXES
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
  <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/95 backdrop-blur-md" onClick={onClose}>
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
    numTimesteps: "100",
    schedule: ScheduleType.LINEAR
  });

  const [targetSnrDb, setTargetSnrDb] = useState<string>("-20");
  const [solverParams, setSolverParams] = useState({
    betaStart: "0.0001",
    numTimesteps: "100"
  });
  const [solvedBetaEnds, setSolvedBetaEnds] = useState<Record<string, number>>({});

  const [customItems, setCustomItems] = useState<ComparisonItem[]>([
    { id: '1', label: 'Linear Baseline', schedule: ScheduleType.LINEAR, betaStart: 0.0001, betaEnd: 0.02, numTimesteps: 100 },
    { id: '2', label: 'Exp Growth', schedule: ScheduleType.EXP, betaStart: 0.0001, betaEnd: 0.035, numTimesteps: 100 }
  ]);

  const [configMode, setConfigMode] = useState<ConfigMode>('manual');
  const [activeTab, setActiveTab] = useState<'charts' | 'table' | 'comparison'>('charts');
  const [enlargedKey, setEnlargedKey] = useState<string | null>(null);
  const [hoverData, setHoverData] = useState<any>(null);

  const numericParams = useMemo(() => ({
    betaStart: parseFloat(params.betaStart) || 0.0001,
    betaEnd: parseFloat(params.betaEnd) || 0.02,
    numTimesteps: Math.max(1, parseInt(params.numTimesteps) || 100),
    schedule: params.schedule
  }), [params]);

  const currentMaxSteps = useMemo(() => {
    if (configMode === 'solver') return parseInt(solverParams.numTimesteps) || 100;
    return numericParams.numTimesteps;
  }, [configMode, solverParams.numTimesteps, numericParams.numTimesteps]);

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
          numTimesteps: parseInt(solverParams.numTimesteps) || 100,
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
      results[type] = solveBetaEndForSNR(snr, parseFloat(solverParams.betaStart) || 0.0001, parseInt(solverParams.numTimesteps) || 100, type);
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

  const selectCustomItem = (item: ComparisonItem) => {
    // Fill the sidebar params with the item's values so the grid view (scheduleData) updates.
    setParams({
      betaStart: item.betaStart.toString(),
      betaEnd: item.betaEnd.toString(),
      numTimesteps: item.numTimesteps.toString(),
      schedule: item.schedule
    });
    // Stay in custom mode so sidebar doesn't jump, but switch to the table.
    setActiveTab('table');
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

  // Smart tick formatter for Y-axis
  const formatYAxis = (val: number, isBeta: boolean) => {
    if (isBeta) {
      if (val === 0) return "0";
      return val < 0.001 ? val.toExponential(2) : val.toFixed(4);
    }
    return val.toFixed(1);
  };

  return (
    <div className="flex flex-col min-h-screen text-lg font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap');
        
        .math-container {
          font-family: 'Libre Baskerville', serif;
          line-height: 1.8;
        }
        .math-symbol {
          font-style: italic;
          color: #818cf8;
          font-weight: 700;
        }
        .math-formula {
          background: rgba(255, 255, 255, 0.03);
          padding: 1.5rem;
          border-radius: 1.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: block;
          margin: 1rem 0;
          font-size: 1.25rem;
        }
        .math-label {
          color: #64748b;
          font-size: 0.7rem;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.3em;
          margin-bottom: 0.75rem;
          display: block;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        .recharts-cartesian-axis-tick-value {
          font-weight: 800;
          fill: #475569;
          font-size: 13px;
        }
      `}</style>

      {enlargedKey && (
        <Modal onClose={() => setEnlargedKey(null)}>
           <div className="h-full flex flex-col">
             <div className="flex items-center gap-6 mb-12">
                <div className="w-5 h-14 bg-indigo-600 rounded-full shadow-lg shadow-indigo-100"></div>
                <h2 className="text-5xl font-black text-slate-900 tracking-tighter">{enlargedKey}</h2>
             </div>
             <ZoomableChartContainer 
               initialNumSteps={currentMaxSteps} 
               isBetaType={enlargedKey.includes("Beta")}
             >
               {({ xDomain, yDomain }) => (
                 <ResponsiveContainer width="100%" height="100%">
                    {enlargedKey.includes("Comparison") ? (
                      <ScatterChart margin={{ top: 20, right: 60, left: 60, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                          type="number" 
                          dataKey="t" 
                          domain={xDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => Math.round(v).toString()}
                          allowDataOverflow 
                          label={{ value: 'Timestep (t)', position: 'bottom', offset: 40, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                          padding={{ left: 30, right: 30 }}
                        />
                        <YAxis 
                          type="number" 
                          domain={yDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => formatYAxis(v, enlargedKey.includes("Beta"))}
                          allowDataOverflow 
                          label={{ value: enlargedKey.includes("Beta") ? 'Variance β' : 'SNR (dB)', angle: -90, position: 'left', offset: -20, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                          padding={{ top: 30, bottom: 30 }}
                        />
                        <ZAxis range={[70, 70]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Legend verticalAlign="top" height={100} iconType="circle" wrapperStyle={{fontSize: 18, fontWeight: 900, paddingBottom: '30px'}}/>
                        {comparativeScatterData.map((series, i) => (
                          <Scatter 
                            key={series.id} 
                            name={series.label} 
                            data={series.points} 
                            fill={scheduleColors[i % scheduleColors.length]} 
                            line={{ stroke: scheduleColors[i % scheduleColors.length], strokeWidth: 5 }}
                            dataKey={enlargedKey.includes("Beta") ? "beta" : "snrDb"}
                          />
                        ))}
                      </ScatterChart>
                    ) : (
                      <ScatterChart margin={{ top: 20, right: 60, left: 60, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis 
                          type="number" 
                          dataKey="t" 
                          domain={xDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => Math.round(v).toString()}
                          allowDataOverflow 
                          label={{ value: 'Timestep (t)', position: 'bottom', offset: 40, fontSize: 18, fontWeight: 900, fill: '#1e293b' }}
                          padding={{ left: 30, right: 30 }}
                        />
                        <YAxis 
                          type="number" 
                          domain={yDomain} 
                          stroke="#64748b" 
                          tickFormatter={(v) => formatYAxis(v, enlargedKey.toLowerCase().includes("beta"))}
                          allowDataOverflow 
                          padding={{ top: 30, bottom: 30 }}
                        />
                        <ZAxis range={[120, 120]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                        {enlargedKey === 'Noise Modifier Factors' ? (
                          <>
                            <Scatter 
                              name="sqrt(ᾱₜ)" 
                              data={scheduleData.filter((_, i) => i % Math.max(1, Math.ceil(scheduleData.length / 600)) === 0)} 
                              fill="#ec4899" 
                              line={{ stroke: "#ec4899", strokeWidth: 6 }}
                              dataKey="sqrtAlphaBar"
                            />
                            <Scatter 
                              name="sqrt(1−ᾱₜ)" 
                              data={scheduleData.filter((_, i) => i % Math.max(1, Math.ceil(scheduleData.length / 600)) === 0)} 
                              fill="#8b5cf6" 
                              line={{ stroke: "#8b5cf6", strokeWidth: 6 }}
                              dataKey="sqrtOneMinusAlphaBar"
                            />
                            <Legend verticalAlign="top" height={100} iconType="circle" wrapperStyle={{fontSize: 18, fontWeight: 900, paddingBottom: '30px'}}/>
                          </>
                        ) : (
                          <Scatter 
                            name={enlargedKey} 
                            data={scheduleData.filter((_, i) => i % Math.max(1, Math.ceil(scheduleData.length / 600)) === 0)} 
                            fill="#6366f1" 
                            line={{ stroke: "#6366f1", strokeWidth: 6 }}
                            dataKey={enlargedKey.toLowerCase().includes("beta") ? "beta" : enlargedKey.toLowerCase().includes("snr") ? "snrDb" : "alphaBar"}
                          />
                        )}
                      </ScatterChart>
                    )}
                 </ResponsiveContainer>
               )}
             </ZoomableChartContainer>
           </div>
        </Modal>
      )}

      <header className="bg-white border-b border-slate-200 py-10 px-16 sticky top-0 z-30 shadow-sm backdrop-blur-xl bg-white/95">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-10">
            <div className="bg-indigo-600 p-6 rounded-[2.5rem] text-white shadow-2xl shadow-indigo-200 transform hover:scale-110 transition-transform cursor-pointer">
              <i className="fas fa-layer-group fa-4xl"></i>
            </div>
            <div>
              <h1 className="text-5xl font-black text-slate-900 tracking-tighter leading-none">Diffusion Engine</h1>
              <p className="text-base text-slate-400 font-black uppercase tracking-[0.5em] mt-4">Noise Dynamics Visualizer v3.1</p>
            </div>
          </div>
          <button onClick={() => downloadCSV(scheduleData)} className="px-12 py-5 bg-slate-900 text-white rounded-[2rem] text-sm font-black shadow-2xl hover:bg-black transition-all flex items-center gap-5 active:scale-95">
            <i className="fas fa-cloud-download-alt"></i> DOWNLOAD DATASET
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-screen-2xl mx-auto w-full p-12 md:p-16 grid grid-cols-1 lg:grid-cols-4 gap-16">
        
        <aside className="lg:col-span-1 space-y-14">
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
                      <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Fixed Value (β)</label>
                      <input type="text" name="betaEnd" value={params.betaEnd} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black text-indigo-600" />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Start Variance (β₀)</label>
                        <input type="text" name="betaStart" value={params.betaStart} onChange={handleInputChange} className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl px-8 py-6 text-2xl font-mono font-black" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">End Variance (βₙ)</label>
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
                    <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Target SNR (dB) @ Step T</label>
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
                      <label className="block text-[11px] font-black text-slate-400 mb-4 uppercase tracking-widest">Total T</label>
                      <input type="text" value={solverParams.numTimesteps} onChange={(e) => setSolverParams({...solverParams, numTimesteps: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 text-sm font-mono font-black" />
                    </div>
                  </div>
                  <button onClick={runGlobalSolver} className="w-full py-7 bg-indigo-600 text-white rounded-[2.5rem] text-sm font-black shadow-2xl hover:bg-indigo-700 transition-all uppercase tracking-widest active:scale-95">RUN PRECISION SOLVER</button>
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
                    <div>
                      <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest">Timesteps (T)</label>
                      <input type="text" name="numTimesteps" value={params.numTimesteps} onChange={handleInputChange} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm font-mono font-bold" />
                    </div>
                    <button onClick={addCustomItem} className="w-full py-5 bg-slate-900 text-white rounded-2xl text-[11px] font-black hover:bg-black transition-all shadow-xl">ADD TO BENCHMARK</button>
                  </div>
                  <div className="space-y-5 max-h-72 overflow-y-auto pr-4 custom-scrollbar">
                    {customItems.map((item) => (
                      <div key={item.id} onClick={() => selectCustomItem(item)} className="p-6 bg-white border border-slate-200 rounded-3xl relative group shadow-sm hover:border-indigo-300 transition-all cursor-pointer">
                        <button onClick={(e) => { e.stopPropagation(); setCustomItems(customItems.filter(ci => ci.id !== item.id)); }} className="absolute top-6 right-6 text-slate-300 hover:text-red-500 transition-colors">
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
            <h3 className="font-black text-xl mb-12 border-b border-white/10 pb-8 flex items-center gap-5 uppercase tracking-[0.3em] text-indigo-400">Mathematical Reference</h3>
            <ul className="space-y-14">
              <li>
                <span className="math-label">Diffusion α Factor</span>
                <span className="math-formula">
                  <span className="math-symbol">αₜ</span> = 1 − <span className="math-symbol">βₜ</span>
                </span>
              </li>
              <li>
                <span className="math-label">Cumulative Maintenance</span>
                <span className="math-formula">
                  <span className="math-symbol">ᾱₜ</span> = Π<span className="math-symbol">ₛ₌₁ᵗ αₛ</span>
                </span>
              </li>
              <li>
                <span className="math-label">Noise Level q(xₜ|x₀)</span>
                <span className="math-formula">
                   𝒩(xₜ; <span className="math-symbol">sqrt(ᾱₜ)</span>x₀, (1 − <span className="math-symbol">ᾱₜ</span>)𝐈)
                </span>
              </li>
              <li>
                <span className="math-label">Signal/Noise (SNR)</span>
                <span className="math-formula">
                  <span className="math-symbol">SNR</span> = <span className="math-symbol">ᾱₜ</span> / (1 − <span className="math-symbol">ᾱₜ</span>)
                  <span className="block text-[11px] font-black text-indigo-400 mt-5 tracking-[0.3em] uppercase">SNR(dB) = 10 · log₁₀(SNR)</span>
                </span>
              </li>
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-3 space-y-16">
          <nav className="flex bg-slate-200/50 p-3 rounded-[3rem] w-fit border border-slate-200 shadow-inner backdrop-blur-lg">
            <button onClick={() => setActiveTab('charts')} className={`px-16 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'charts' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>VISUAL ANALYTICS</button>
            <button onClick={() => setActiveTab('comparison')} className={`px-16 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'comparison' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>BENCHMARK MATRIX</button>
            <button onClick={() => setActiveTab('table')} className={`px-16 py-5 rounded-[2.5rem] text-sm font-black transition-all ${activeTab === 'table' ? 'bg-white text-indigo-600 shadow-2xl border border-slate-100' : 'text-slate-500 hover:text-slate-700'}`}>GRID VIEW</button>
          </nav>

          {activeTab === 'charts' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <ChartCard title="Beta Schedule (βₜ)" data={scheduleData} dataKey="beta" color="#6366f1" onEnlarge={() => setEnlargedKey('Beta Schedule (βₜ)')} isBetaType={true} />
              <ChartCard title="SNR Evolution (dB)" data={scheduleData} dataKey="snrDb" color="#f59e0b" suffix=" dB" onEnlarge={() => setEnlargedKey('SNR Evolution (dB)')} isBetaType={false} />
              <ChartCard title="Noise Modifier Factors" data={scheduleData} dataKeys={['sqrtAlphaBar', 'sqrtOneMinusAlphaBar']} names={['sqrt(ᾱₜ)', 'sqrt(1−ᾱₜ)']} color="#ec4899" onEnlarge={() => setEnlargedKey('Noise Modifier Factors')} isBetaType={false} />
              <ChartCard title="Cumulative Maintenance (ᾱₜ)" data={scheduleData} dataKey="alphaBar" color="#8b5cf6" onEnlarge={() => setEnlargedKey('Cumulative Maintenance (ᾱₜ)')} isBetaType={false} />
            </div>
          )}

          {activeTab === 'comparison' && (
            <div className="space-y-16 animate-in fade-in slide-in-from-bottom-5 duration-700">
              <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 p-16 relative overflow-hidden h-[850px]">
                <div className="flex justify-between items-center mb-12">
                  <div className="space-y-3">
                    <h3 className="text-4xl font-black text-slate-900 flex items-center gap-6 tracking-tighter">Variance Comparison Benchmark</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Global Multi-Strategy Performance Analysis</p>
                  </div>
                  <button onClick={() => setEnlargedKey('Comparison: Beta (βₜ)')} className="text-slate-200 hover:text-indigo-600 transition-colors p-4"><i className="fas fa-expand-arrows-alt fa-3x"></i></button>
                </div>
                <div className="h-[480px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 30, left: 30, bottom: 30 }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverData(null)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" dataKey="t" tick={{fontSize: 14, fontWeight: 900}} stroke="#cbd5e1" padding={{ left: 10, right: 10 }} />
                      <YAxis type="number" stroke="#cbd5e1" tickFormatter={(v) => formatYAxis(v, true)} padding={{ top: 10, bottom: 10 }} />
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
                          dataKey="beta"
                          shape="circle" 
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                
                {hoverData && (
                  <div className="absolute top-36 right-16 bottom-36 w-[480px] bg-slate-950 text-white p-14 rounded-[4rem] shadow-3xl z-40 border border-white/5 overflow-y-auto custom-scrollbar shadow-indigo-500/20 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="flex justify-between items-center mb-10 border-b border-white/10 pb-8">
                      <span className="text-xs font-black uppercase tracking-[0.4em] text-indigo-400">Step Matrix</span>
                      <span className="bg-indigo-600 px-8 py-3 rounded-2xl text-lg font-black tracking-tighter shadow-xl">t = {hoverData.t}</span>
                    </div>
                    <div className="flex flex-col gap-8">
                      {Object.entries(hoverData).map(([name, data]: [string, any]) => {
                        if (name === 't') return null;
                        return (
                          <div key={name} className="flex flex-col gap-4 bg-white/5 p-8 rounded-[3rem] border border-white/5 hover:bg-white/10 transition-colors">
                            <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.4em] truncate">{name}</span>
                            <div className="flex justify-between items-end">
                              <span className="font-mono text-2xl font-black text-indigo-300">{(data.beta as number).toExponential(3)}</span>
                              <span className="font-mono text-sm font-bold text-amber-500">{(data.snrDb as number).toFixed(2)} dB</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-[4rem] shadow-2xl border border-slate-100 p-16 relative overflow-hidden h-[680px]">
                <div className="flex justify-between items-center mb-12">
                  <div className="space-y-3">
                    <h3 className="text-4xl font-black text-slate-900 flex items-center gap-6 tracking-tighter">SNR (dB) Comparison Spectrum</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Maintenance Efficiency Analysis</p>
                  </div>
                  <button onClick={() => setEnlargedKey('Comparison: SNR (dB)')} className="text-slate-200 hover:text-indigo-600 transition-colors p-4"><i className="fas fa-expand-arrows-alt fa-3x"></i></button>
                </div>
                <div className="h-[460px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 30, left: 30, bottom: 30 }} onMouseMove={handleMouseMove} onMouseLeave={() => setHoverData(null)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis type="number" dataKey="t" tick={{fontSize: 14, fontWeight: 900}} stroke="#cbd5e1" padding={{ left: 10, right: 10 }} />
                      <YAxis type="number" stroke="#cbd5e1" domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} padding={{ top: 10, bottom: 10 }} />
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
                          dataKey="snrDb"
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
              <div className="overflow-x-auto max-h-[950px] custom-scrollbar">
                <table className="w-full text-left text-base font-medium border-collapse">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 z-10">
                    <tr>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Step t</th>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Beta βₜ</th>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Alpha ᾱₜ</th>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Residual 1−ᾱₜ</th>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">Factor sqrt(ᾱₜ)</th>
                      <th className="px-16 py-10 font-black text-slate-400 uppercase text-xs tracking-widest text-center">SNR (dB)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-center">
                    {scheduleData.filter((_, i) => i % (numericParams.numTimesteps > 1000 ? 50 : 1) === 0).map((row) => (
                      <tr key={row.t} className="hover:bg-indigo-50/50 transition-colors group">
                        <td className="px-16 py-8 font-mono text-sm text-slate-400 group-hover:text-indigo-600 font-bold">{row.t}</td>
                        <td className="px-16 py-8 font-mono text-sm font-black text-indigo-600">{row.beta.toExponential(6)}</td>
                        <td className="px-16 py-8 font-mono text-sm">{row.alphaBar.toFixed(8)}</td>
                        <td className="px-16 py-8 font-mono text-sm">{row.oneMinusAlphaBar.toFixed(8)}</td>
                        <td className="px-16 py-8 font-mono text-sm">{row.sqrtAlphaBar.toFixed(8)}</td>
                        <td className="px-16 py-8 font-mono text-sm text-amber-600 font-black">{row.snrDb.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-36 px-16 mt-32 text-center text-slate-400 text-xs uppercase font-black tracking-[1.2em]">
        <div className="max-w-screen-2xl mx-auto flex flex-col items-center gap-16">
           <div className="flex gap-28 opacity-10 grayscale transition-all hover:grayscale-0 hover:opacity-100 cursor-default">
             <i className="fas fa-brain fa-5x"></i>
             <i className="fas fa-wave-square fa-5x"></i>
             <i className="fas fa-flask fa-5x"></i>
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
  isBetaType: boolean;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, data, dataKey, dataKeys, names, color, suffix = "", onEnlarge, isBetaType }) => {
  const chartPoints = useMemo(() => {
    if (!data || data.length === 0) return [];
    const step = Math.max(1, Math.ceil(data.length / 150));
    return data.filter((_, i) => i % step === 0);
  }, [data]);

  const colors = ['#ec4899', '#8b5cf6', '#f59e0b', '#10b981'];

  const formatY = (val: number) => {
    if (isBetaType) {
       return val < 0.001 ? val.toExponential(2) : val.toFixed(4);
    }
    return val.toFixed(1);
  };

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
            <ScatterChart margin={{ top: 5, right: 15, left: -20, bottom: 5 }} data={chartPoints}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f8fafc" />
              <XAxis type="number" dataKey="t" tick={{fontSize: 12, fontWeight: 900}} stroke="#cbd5e1" />
              <YAxis 
                type="number" 
                tick={{fontSize: 12, fontWeight: 900}} 
                stroke="#cbd5e1" 
                domain={['auto', 'auto']} 
                tickFormatter={formatY}
              />
              <ZAxis range={[50, 50]} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: any) => [typeof v === 'number' ? v.toExponential(4) + suffix : v, '']} />
              
              {dataKey ? (
                <Scatter name={title} data={chartPoints} fill={color} line={{ stroke: color, strokeWidth: 5 }} shape="circle" dataKey={dataKey as string} />
              ) : dataKeys?.map((key, i) => (
                <Scatter key={key as string} name={names?.[i] || (key as string)} data={chartPoints.map(p => ({ t: p.t, val: (p as any)[key] }))} fill={colors[i % colors.length]} line={{ stroke: colors[i % colors.length], strokeWidth: 5 }} dataKey="val" />
              ))}
              
              {names && <Legend wrapperStyle={{ fontSize: '12px', fontWeight: 900, paddingTop: '40px' }} />}
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-slate-300 text-xs font-black uppercase tracking-widest">Synthesizing...</div>
        )}
      </div>
    </div>
  );
};

export default App;
