import { Request, Response } from 'express';
import { AnalysisParameters, AnalysisResult, runAnalysis } from '../services/analysisService';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message: string;
}

interface AnalyzeSingleRequestBody {
  symbol?: string;
  parameters?: AnalysisParameters;
}

// 路由层：参数校验后直接同步运行分析并返回结果
export const analyzeSingle = async (
  req: Request,
  res: Response<ApiResponse<AnalysisResult>>
): Promise<Response<ApiResponse<AnalysisResult>>> => {
  try {
    const { symbol, parameters = {} } = (req.body || {}) as AnalyzeSingleRequestBody;

    // 仅支持 A 股 6 位数字代码
    if (!symbol || !/^\d{6}$/.test(symbol)) {
      return res.status(400).json({ success: false, message: '仅支持 6 位 A 股代码' });
    }

    const result = await runAnalysis({ symbol, parameters });
    return res.json({ success: true, data: result, message: '分析完成' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务异常';
    return res.status(500).json({ success: false, message });
  }
};
