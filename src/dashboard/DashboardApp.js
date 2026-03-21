import React from 'react';
import ReactDOM from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import htm from 'https://esm.sh/htm';

const html = htm.bind(React.createElement);

// ── 1. 数据桥接与状态挂载 ─────────────────────────
function useDashboardData() {
    const [data, setData] = React.useState(window.__DASHBOARD_DATA__ || null);

    React.useEffect(() => {
        const handleData = (e) => {
            console.log("Dashboard received backend data:", e.detail);
            setData(e.detail);
        };
        window.addEventListener("golf_dashboard_data", handleData);
        
        const handleActive = () => {
             // 强制刷一下 state
             if (window.__DASHBOARD_DATA__) setData(window.__DASHBOARD_DATA__);
        };
        window.addEventListener("golf_dashboard_active", handleActive);

        return () => {
            window.removeEventListener("golf_dashboard_data", handleData);
            window.removeEventListener("golf_dashboard_active", handleActive);
        };
    }, []);

    return data;
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

// ── 3. 3D 画布组件 (React Three Fiber) ─────────────
function Dashboard3D({ history }) {
    return html`
        <${Canvas} camera=${{ position: [0, 0, 1000], far: 3000 }}>
            <ambientLight intensity=${0.6} />
            <pointLight position=${[0, 100, 500]} />
            
            <gridHelper args=${[2000, 50, '#00f3ff', '#1a2035']} rotation=${[Math.PI / 2, 0, 0]} />
            
            <mesh position=${[0,0,0]}>
                <boxGeometry args=${[120, 120, 120]} />
                <meshStandardMaterial color="#00f3ff" emissive="#002233" />
            </mesh>
        <//>
    `;
}

// ── 4. 主大屏面板 ─────────────────────────────────
function DashboardApp() {
    const data = useDashboardData();
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
                        if (tabCamera) tabCamera.click(); // 退回首页
                    }}>返回旧版</button>
                </div>
            </header>

            <div style=${{ flex: 1, display: 'flex', position: 'relative' }}>
                <div style=${{ width: '300px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid rgba(255,255,255,0.05)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style=${{ border: '1px solid rgba(0,243,255,0.2)', padding: '15px', background: 'rgba(0,243,255,0.02)' }}>
                        <h4 style=${{ margin: '0 0 10px 0', fontSize: '14px', color: '#00f3ff' }}>核心指标 (SPI)</h4>
                        <div style=${{ height: '160px' }}>
                            <${Chart} option=${gaugeOption} />
                        </div>
                    </div>
                </div>

                <div style=${{ flex: 1, position: 'relative' }}>
                    <${Dashboard3D} history=${data?.fullHistory || []} />
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
const root = ReactDOM.createRoot(document.getElementById('dashboardApp'));
root.render(React.createElement(DashboardApp));
