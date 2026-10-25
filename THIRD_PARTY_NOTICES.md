# 第三方依赖与资源来源

记录日期：2026-10-11。版本与许可证字段来自本副本已安装包的 package.json。

| 依赖 | 本地版本 | 包声明许可证 |
| --- | --- | --- |
| @mediapipe/tasks-vision | 1.1.0 | Apache-2.0 |
| echarts | 6.1.0 | Apache-2.0 |
| idb | 8.0.4 | ISC |
| lucide-vue-next | 0.577.0 | ISC |
| reka-ui | 2.11.0 | MIT |
| tailwindcss | 4.3.3 | MIT |
| @tailwindcss/vite | 4.3.3 | MIT |
| vue | 3.5.43 | MIT |
| vue-router | 5.4.0 | MIT |
| pinia | 4.0.3 | MIT |

可获得的上游 LICENSE / NOTICE 原文保留在 docs/licenses。传递依赖仍遵循各自原始许可，正式分发时应按实际构建内容保留相应声明。

## 模型与 WASM

WASM 由 @mediapipe/tasks-vision 包复制到 public/wasm。姿态与人脸模型从 Google 官方 mediapipe-models 地址下载。准确下载地址、文件大小和 SHA-256 记录在 public/models/sources.json。

- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker

模型资源的使用范围按其官方说明确认，不把软件包声明直接扩展为所有第三方资源的授权。

## 项目自身实现

本副本的业务代码、布局和 SVG 插画为此次新增/改写，包含 AI 辅助实现。没有直接纳入参考文件夹中的 GPL 项目源码、未明确授权的源码或外国网站的商业图片。

开发思路来自已有项目规划与参考评估；关键点模型、框架、图表和控件等第三方内容独立列明。项目自己的权属、开源许可与登记信息由团队和学校确认。
