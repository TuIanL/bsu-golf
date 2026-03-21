import numpy as np

class GolfClubTracker:
    def __init__(self, dt: float = 1.0, process_noise_var: float = 100.0, high_conf_r: float = 10.0, mod_conf_r: float = 100.0):
        """
        二维恒速 (CV) 模型的卡尔曼滤波器，用于追踪和预测高尔夫杆头位置。
        
        :param dt: 帧间隔，默认 1.0（即 1 帧）
        :param process_noise_var: 过程噪声方差，决定了我们允许杆头速度变化的剧烈程度
        :param high_conf_r: 测量噪声协方差 (高置信度时)，强制信任 YOLO
        :param mod_conf_r: 测量噪声协方差 (中置信度时)，平衡预测与 YOLO
        """
        self.dt = dt
        self.high_conf_r = high_conf_r
        self.mod_conf_r = mod_conf_r
        
        # 1. 状态向量 X: [x, y, v_x, v_y]^T
        # 初始化时均为 0，应在第一次捕获到目标时被覆盖
        self.X = np.zeros((4, 1), dtype=np.float32)
        
        # 状态协方差矩阵 P (初始巨大，代表对初始状态极度不自信)
        self.P = np.eye(4, dtype=np.float32) * 1000.0
        
        # 2. 状态转移矩阵 F:
        # [1, 0, dt, 0 ]
        # [0, 1, 0,  dt]
        # [0, 0, 1,  0 ]
        # [0, 0, 0,  1 ]
        self.F = np.array([
            [1.0, 0.0,  dt, 0.0],
            [0.0, 1.0, 0.0,  dt],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ], dtype=np.float32)
        
        # 3. 观测矩阵 H: (只观测到位置 x, y)
        # [1, 0, 0, 0]
        # [0, 1, 0, 0]
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0]
        ], dtype=np.float32)
        
        # 4. 过程噪声矩阵 Q (离散白噪声加速模型)
        # 假设加速度项 a 带来了过程噪声：位置噪声与 dt^4 有关，速度与 dt^2 有关，互协方差与 dt^3 有关。
        dt2 = dt**2 / 2.0
        dt3 = dt**3 / 2.0
        dt4 = dt**4 / 4.0
        
        self.Q = np.array([
            [dt4, 0.0, dt3, 0.0],
            [0.0, dt4, 0.0, dt3],
            [dt3, 0.0, dt**2, 0.0],
            [0.0, dt3, 0.0, dt**2]
        ], dtype=np.float32) * process_noise_var
        
        # 单位矩阵，用于计算后验协方差
        self.I = np.eye(4, dtype=np.float32)
        
        # 状态机标识
        self.is_initialized = False
        self.missed_frames = 0
        
    def _predict(self):
        """预测阶段 (Predict)：使用前一帧状态推算当前帧的先验状态"""
        # X_predict = F * X_{t-1}
        self.X = np.dot(self.F, self.X)
        # P_predict = F * P_{t-1} * F^T + Q
        self.P = np.dot(np.dot(self.F, self.P), self.F.T) + self.Q

    def _update(self, z: np.ndarray, R: np.ndarray):
        """
        更新阶段 (Update)：结合观测到的坐标与预测坐标，计算卡尔曼增益并刷新后验状态
        :param z: 观测向量 [x, y]^T
        :param R: 测量噪声协方差矩阵 (根据置信度动态获取)
        """
        # 1. 计算测量残差 (Measurement Innovation) y = z - H * X_predict
        y = z - np.dot(self.H, self.X)
        
        # 2. 计算系统不确定度 S = H * P_predict * H^T + R
        S = np.dot(np.dot(self.H, self.P), self.H.T) + R
        
        # 3. 计算卡尔曼增益 K = P_predict * H^T * S^{-1}
        K = np.dot(np.dot(self.P, self.H.T), np.linalg.inv(S))
        
        # 4. 更新后验状态 X = X_predict + K * y
        self.X = self.X + np.dot(K, y)
        
        # 5. 更新后验协方差 P = (I - K * H) * P_predict
        self.P = np.dot((self.I - np.dot(K, self.H)), self.P)

    def update_track(self, yolo_bbox, confidence: float) -> tuple[float, float]:
        """
        核心跟踪入口，处理每一帧的预测与更新。
        
        :param yolo_bbox: YOLO 识别框字典，例如 {'x': 100, 'y': 200, ...} 或者是中心点元组 (x, y)。如果完全没检测到填 None。
        :param confidence: YOLO 框的置信度，用于动态调节 R 矩阵。如果 yolo_bbox 是 None，此项通常传 0。
        :return: (x, y) 本帧最终采信的杆头坐标 (像素/归一化均可，保持统一即可)
        """
        # 1. 提取观测坐标 z
        z = None
        if yolo_bbox is not None:
            if isinstance(yolo_bbox, dict):
                # 假设 bbox 里包含 x 和 y，如果是 (x, y, w, h) 的中心点：
                z = np.array([[yolo_bbox.get('x', 0.0)], [yolo_bbox.get('y', 0.0)]], dtype=np.float32)
            elif isinstance(yolo_bbox, (tuple, list)) and len(yolo_bbox) >= 2:
                z = np.array([[yolo_bbox[0]], [yolo_bbox[1]]], dtype=np.float32)
        
        # 2. 冷启动初始化
        if not self.is_initialized:
            if z is not None and confidence > 0.5:
                # 首次强力检测，初始化坐标，速度置0
                self.X[0, 0] = z[0, 0]
                self.X[1, 0] = z[1, 0]
                self.X[2, 0] = 0.0
                self.X[3, 0] = 0.0
                self.is_initialized = True
                self.missed_frames = 0
                return (z[0, 0], z[1, 0])
            else:
                return (0.0, 0.0) # 尚未初始化，没有可信点

        # 3. Predict：无论如何，先进行纯物理惯学预测推演
        self._predict()
        
        # 4. Update 动态分支决策
        if z is not None and confidence > 0.2:
            self.missed_frames = 0
            
            # 启发式动态噪声表：基于 YOLO置信度调节测量噪声的体量
            if confidence > 0.6:
                # 非常清晰：强制把KF的状态往 YOLO 检测结果拉近
                R = np.eye(2, dtype=np.float32) * self.high_conf_r
            else:
                # 模糊期间：给预测模型留足话语权，不让 YOLO 的弱标注生拽轨道
                R = np.eye(2, dtype=np.float32) * self.mod_conf_r
                
            # 执行合并
            self._update(z, R)
        else:
            # 丢失 (Miss)：YOLO 瞎了。跳过 _update！
            # 此时的 self.X 等于 _predict 刚刚计算出来的纯物理抛物线推演
            self.missed_frames += 1

        # 无论更新与否，self.X[0, 0] 和 self.X[1, 0] 都在本帧代表了 KF 对物理世界最终的综合判定
        final_x = float(self.X[0, 0])
        final_y = float(self.X[1, 0])
        
        return (final_x, final_y)
