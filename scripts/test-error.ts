// 错误模式识别 + 错误事件链路验证
import { classifyError } from '../src/utils/errorClassify';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(extra)}`);
  if (!cond) failures++;
}

check('401 auth', classifyError('HTTP 401 Unauthorized') === 'auth');
check('auth token', classifyError('Error: invalid_api_key provided') === 'auth');
check('not logged in', classifyError('Not logged in · Please run /login') === 'auth');
check('429 quota', classifyError('429 Too Many Requests: rate_limit_exceeded') === 'quota');
check('quota insufficient', classifyError('insufficient_quota: balance exhausted') === 'quota');
check('model not found', classifyError('model_not_found: kimi-k9 does not exist') === 'model');
check('model not configured', classifyError('invalid: Model "kimi-code/nonexistent-model" is not configured in config.toml') === 'model');
check('network econn', classifyError('fetch failed: ECONNREFUSED 127.0.0.1:443') === 'network');
check('network timeout', classifyError('ETIMEDOUT connecting to api') === 'network');
check('unknown', classifyError('some random failure') === 'unknown');
// 不误伤
check('normal text unknown', classifyError('编译完成，exit 0') === 'unknown');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
