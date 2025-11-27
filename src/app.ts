import './config/env';
import express from 'express';
import bodyParser from 'body-parser';
import { analyzeSingle } from './routes/analysis';

// 简易 Express 服务入口，仅暴露 /analysis/single 同步返回分析结果
const app = express();
app.use(bodyParser.json());

// 单股分析
app.post('/analysis/single', analyzeSingle);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Analysis server listening on ${PORT}`);
});

export default app;
