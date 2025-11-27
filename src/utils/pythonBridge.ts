import { spawn } from 'node:child_process';
import path from 'node:path';

export async function runPythonScript<T = unknown>(scriptName: string, payload: any): Promise<T> {
  const scriptPath = path.resolve(__dirname, '..', '..', 'py-bridge', scriptName);
  return new Promise((resolve, reject) => {
    const py = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';

    py.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    py.on('error', (err) => {
      reject(new Error(`无法启动 Python 进程: ${err.message}`));
    });

    py.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as T);
        } catch (e) {
          reject(new Error(`解析 Python 输出失败: ${(e as Error).message}`));
        }
      } else {
        reject(new Error(`Python 脚本退出码 ${code}`));
      }
    });

    try {
      py.stdin.write(JSON.stringify(payload));
      py.stdin.end();
    } catch (e) {
      reject(new Error(`写入 Python stdin 失败: ${(e as Error).message}`));
    }
  });
}
