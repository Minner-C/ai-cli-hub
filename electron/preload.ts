// preload：经 contextBridge 暴露类型安全 API（contextIsolation 开启，nodeIntegration 关闭）
import { contextBridge } from 'electron';
import { buildHubApi } from './hubApi';

contextBridge.exposeInMainWorld('hub', buildHubApi());
