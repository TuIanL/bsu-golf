import React from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

// ── 1. 数据桥接与状态挂载 ─────────────────────────
function useDashboardData() {
    const [data, setData] = React.useState(window.__DASHBOARD_DATA__ || null);
    const [frameIdx, setFrameIdx] = React.useState(0);
    const [isPlaying, setIsPlaying] = React.useState(false);

    React.useEffect(() => {
        const handleData = (e) => {
            console.log("Dashboard received backend data:", e.detail);
            setData(e.detail);
            setFrameIdx(0); 
            setIsPlaying(true); 
        };
        window.addEventListener("golf_dashboard_data", handleData);
        
        const handleActive = () => {
             if (window.__DASHBOARD_DATA__) {
                 setData(window.__DASHBOARD_DATA__);
             }
        };
        window.addEventListener("golf_dashboard_active", handleActive);

        return () => {
            window.removeEventListener("golf_dashboard_data", handleData);
            window.removeEventListener("golf_dashboard_active", handleActive);
        };
    }, []);

    React.useEffect(() => {
        let timer;
        if (isPlaying && data?.fullHistory?.length > 0) {
            timer = setInterval(() => {
                setFrameIdx(prev => {
                    if (prev >= data.fullHistory.length - 1) {
                        setIsPlaying(false);
                        return prev;
                    }
                    return prev + 1;
                });
            }, 60); 
        }
        return () => clearInterval(timer);
    }, [isPlaying, data]);

    return { data, frameIdx, setFrameIdx, isPlaying, setIsPlaying };
}

// ── 2. ECharts 通用 React 包装组件 ─────────────────
const Chart = ({ option, style }) => {
    const chartRef = React.useRef(null);
    const chartInstance = React.useRef(null);

    React.useEffect(() => {
        if (chartRef.current && window.echarts) {
            if (!chartInstance.current) {
                chartInstance.current = window.echarts.init(chartRef.current);
            }
            chartInstance.current.setOption(option);
        }
    }, [option]);

    React.useEffect(() => {
        const handleResize = () => chartInstance.current?.resize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    return html`<div ref=${chartRef} style=${{ width: '100%', height: '100%', ...style }} />`;
};

// ── 3. 3D 画布组件 旋转子代 ────────────────────────
// 人体骨骼连接序列
const SKELETON_CONNECTIONS = [
    [11, 12], [12, 24], [24, 23], [23, 11], // 躯干
    [11, 13], [13, 15], [12, 14], [14, 16], // 双臂
    [23, 25], [25, 27], [24, 26], [26, 28], // 双腿
    [15, 17], [16, 18], [15, 19], [16, 20]  // 手掌
];

function Skeleton3D({ landmarks }) {
    if (!landmarks || landmarks.length === 0) return null;

    // 将 MediaPipe 2D+Z 坐标映射到 3D 空间
    const getPoint = (idx) => {
        const pt = landmarks[idx];
        if (!pt) return [0,0,0];
        // 缩放并居中，Y 轴向下是 MediaPipe 标准，Three.js Y 轴向上，所以取负
        return [(pt.x - 0.5) * 800, -(pt.y - 0.5) * 800, (pt.z || 0) * -300];
    };

    return html`
        <group>
            <!-- 骨骼节点球心 -->
            ${[11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].map(idx => html`
                <mesh key=${idx} position=${getPoint(idx)}>
                    <sphereGeometry args=${[8, 16, 16]} />
                    <meshStandardMaterial color="#00f3ff" emissive="#004455" />
                </mesh>
            `)}

            <!-- 骨架连接线暂代方案 (由于 UMD 无 TubeGeometry) 可以使用 Mesh 连结 -->
            <!-- 如果为了极速，可以使用 3D 空间线。 R3F Canvas 包含默认 BufferGeometryLine  -->
        </group>
    `;
}

function Dashboard3D({ history, currentFrame }) {
    const landmarks = history?.[currentFrame]?.landmarks || [];

    return html`
        <${Canvas} camera=${{ position: [0, 0, 800], far: 3000 }}>
            <ambientLight intensity=${0.5} />
            <pointLight position=${[0, 200, 500]} intensity=${1.5} color="#ffffff" />
            
            <gridHelper args=${[2000, 40, '#00f3ff', '#121a2b']} rotation=${[Math.PI / 2, 0, 0]} />
            
            <${Skeleton3D} landmarks=${landmarks} />
        <//>
    `;
}

// ── 4. 主大屏面板 ─────────────────────────────────
function DashboardApp() {
    const { data, frameIdx, setFrameIdx, isPlaying, setIsPlaying } = useDashboardData();
    const mockScore = data?.score || 85;

    const gaugeOption = {
        backgroundColor: 'transparent',
        series: [{
            type: 'gauge', radius: '85%', min: 0, max: 120, splitNumber: 4,
            axisLine: { lineStyle: { width: 12, color: [[0.6, '#ff2a2a'], [0.9, '#ff7a00'], [1, '#00f3ff']] } },
            pointer: { itemStyle: { color: '#ffffff' } },
            detail: { formatter: '{value}', color: '#00f3ff', fontSize: 36, offsetCenter: [0, '70%'] },
            data: [{ value: mockScore }]
        }]
    };

    const radarOption = {
        backgroundColor: 'transparent',
        radar: {
            indicator: [
                { name: '准备-站位比例', max: 5 },
                { name: '准备-肩部倾角', max: 50 },
                { name: '顶点-左臂角度', max: 180 },
                { name: '顶点-肩部旋转', max: 180 },
                { name: '击球-髋部旋转', max: 180 }
            ],
            splitArea: { show: false },
            splitLine: { lineStyle: { color: 'rgba(0, 243, 255, 0.2)' } },
            axisLine: { lineStyle: { color: 'rgba(0, 243, 255, 0.2)' } },
            name: { textStyle: { color: '#88a0b0', fontSize: 10 } }
        },
        series: [{
            type: 'radar',
            data: [
                { value: [2.5, 25, 90, 80, 90], name: '标准标准', itemStyle: { color: '#444' }, lineStyle: { type: 'dashed' } },
                { 
                    value: [
                        data?.extracted_features?.["ADDRESS_STANCE_RATIO"] || 0,
                        data?.extracted_features?.["ADDRESS_SHOULDER_ANGLE"] || 0,
                        data?.extracted_features?.["TOP_LEFT_ARM_ANGLE"] || 0,
                        data?.extracted_features?.["TOP_SHOULDER_ROTATION_THETA"] || 0,
                        data?.extracted_features?.["IMPACT_HIP_ROTATION_THETA"] || 0
                    ], 
                    name: '您的数据', itemStyle: { color: '#00f3ff' }, areaStyle: { color: 'rgba(0, 243, 255, 0.15)' } 
                }
            ]
        }]
    };

    const lineOption = {
        backgroundColor: 'transparent',
        grid: { top: '15%', bottom: '20%', left: '8%', right: '5%' },
        xAxis: {
            type: 'category', data: ['Address', 'Top', 'Impact', 'Follow'],
            axisLine: { lineStyle: { color: '#444' } }, axisLabel: { color: '#888', fontSize: 10 }
        },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } }, axisLabel: { color: '#888' } },
        series: [{
            data: [10, 45, 120, 60], type: 'line', smooth: true, symbol: 'none',
            lineStyle: { width: 3, color: '#ff7a00', shadowColor: '#ff7a00', shadowBlur: 10 },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255, 122, 0, 0.3)' }, { offset: 1, color: 'rgba(255, 122, 0, 0)' }] } }
        }]
    };

    return html`
        <div style=${{
            position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
            display: 'flex', flexDirection: 'column', background: '#080c14', fontFamily: 'sans-serif', color: '#fff', overflow: 'hidden'
        }}>
            <header style=${{ height: '60px', borderBottom: '1px solid rgba(0,243,255,0.2)', display: 'flex', alignItems: 'center', padding: '0 20px', background: '#0a0f18' }}>
                <h1 style=${{ color: '#00f3ff', fontSize: '20px', letterSpacing: '2px', textShadow: '0 0 10px #00f3ff', margin: 0 }}>高尔夫 AI 全景姿态大屏</h1>
                <div style=${{ marginLeft: 'auto' }}>
                    <button style=${{ background: 'transparent', border: '1px solid #00f3ff', color: '#00f3ff', padding: '6px 16px', cursor: 'pointer', borderRadius: '4px' }} onClick=${() => {
                        const dashboardApp = document.getElementById("dashboardApp");
                        if (dashboardApp) dashboardApp.style.display = "none";
                        const tabCamera = document.getElementById("tabCamera");
                        if (tabCamera) tabCamera.click();
                    }}>返回旧版</button>
                </div>
            </header>

            <div style=${{ flex: 1, display: 'flex', position: 'relative' }}>
                <div style=${{ width: '300px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid rgba(255,255,255,0.05)', padding: '15px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style=${{ border: '1px solid rgba(0,243,255,0.2)', padding: '15px', background: 'rgba(0,243,255,0.02)' }}>
                        <h4 style=${{ margin: '0 0 10px 0', fontSize: '13px', color: '#00f3ff' }}>核心指标 (SPI)</h4>
                        <div style=${{ height: '140px' }}>
                            <${Chart} option=${gaugeOption} />
                        </div>
                    </div>

                    <div style=${{ border: '1px solid rgba(0,243,255,0.2)', padding: '15px', background: 'rgba(0,243,255,0.02)', flex: 1 }}>
                        <h4 style=${{ margin: '0 0 10px 0', fontSize: '13px', color: '#00f3ff' }}>生物力学雷达 (Biometrics)</h4>
                        <div style=${{ height: '220px' }}>
                            <${Chart} option=${radarOption} />
                        </div>
                    </div>
                </div>

                <div style=${{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style=${{ flex: 1, position: 'relative' }}>
                        <${Dashboard3D} history=${data?.fullHistory} currentFrame=${frameIdx} />
                        
                        ${data?.fullHistory?.length > 0 && html`
                            <div style=${{ position: 'absolute', bottom: '20px', left: '10%', width: '80%', background: 'rgba(0,0,0,0.7)', padding: '12px 20px', borderRadius: '14px', display: 'flex', gap: '20px', alignItems: 'center', backdropFilter: 'blur(10px)', border: '1px solid rgba(0,243,255,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100 }}>
                                <button 
                                    onClick=${() => {
                                        if (frameIdx >= data.fullHistory.length - 1) {
                                            setFrameIdx(0);
                                            setIsPlaying(true);
                                        } else {
                                            setIsPlaying(!isPlaying);
                                        }
                                    }}
                                    style=${{ 
                                        width: '40px', 
                                        height: '40px', 
                                        borderRadius: '50%', 
                                        border: 'none',
                                        cursor: 'pointer', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        justifyContent: 'center',
                                        background: isPlaying ? 'rgba(0,243,255,0.1)' : '#00f3ff',
                                        color: isPlaying ? '#00f3ff' : '#080c14',
                                        boxShadow: isPlaying ? 'none' : '0 0 15px rgba(0,243,255,0.5)',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        fontSize: '18px'
                                    }}
                                >
                                    ${frameIdx >= data.fullHistory.length - 1 ? '🔄' : (isPlaying ? '▍▍' : '▶')}
                                </button>

                                <div style=${{ color: '#00f3ff', fontSize: '13px', minWidth: '80px', fontFamily: '"JetBrains Mono", monospace' }}>
                                    帧: ${frameIdx + 1}/${data.fullHistory.length}
                                </div>
                                
                                <input 
                                    type="range" 
                                    min="0" 
                                    max=${data.fullHistory.length - 1} 
                                    value=${frameIdx} 
                                    onInput=${(e) => {
                                        setFrameIdx(parseInt(e.target.value));
                                        setIsPlaying(false);
                                    }} 
                                    style=${{ 
                                        flex: 2, 
                                        cursor: 'pointer', 
                                        accentColor: '#00f3ff',
                                        height: '4px',
                                        opacity: 0.8
                                    }} 
                                />
                            </div>
                        `}
                    </div>
                    
                    <div style=${{ height: '160px', borderTop: '1px solid rgba(0,243,255,0.1)', background: 'rgba(11,20,35,0.4)', padding: '15px', position: 'relative' }}>
                        <h4 style=${{ margin: '0 0 5px 0', fontSize: '13px', color: '#ff7a00', position: 'absolute', top: '10px', left: '15px' }}>手腕速度运动学曲线 (Kinematics)</h4>
                        <${Chart} option=${lineOption} />
                    </div>
                </div>

                <div style=${{ width: '350px', background: 'rgba(0,0,0,0.3)', borderLeft: '1px solid rgba(255,255,255,0.05)', padding: '20px' }}>
                    <div style=${{ border: '1px solid rgba(255,122,0,0.2)', padding: '15px', height: '100%', background: 'rgba(255,122,0,0.02)' }}>
                        <h4 style=${{ margin: '0 0 15px 0', fontSize: '14px', color: '#ff7a00' }}>领域分配诊断 (XAI)</h4>
                        <ul style=${{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            ${data?.nam_explanations?.map((item, idx) => html`
                                <li key=${idx} style=${{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderLeft: '3px solid #ff7a00' }}>
                                    <div style=${{ fontSize: '13px', color: '#ff7a00', fontWeight: 'bold' }}>${item.featureKey}</div>
                                    <div style=${{ fontSize: '12px', color: '#d1d5db', marginTop: '4px' }}>${item.diagnosticText}</div>
                                </li>
                            `) || html`<div style=${{ color: '#666', fontSize: '12px' }}>📊 传输完毕后将呈现 XAI 诊断...</div>`}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    `;
}

console.log("Mounting Dashboard App to DOM...");
const root = createRoot(document.getElementById('dashboardApp'));
root.render(React.createElement(DashboardApp));
