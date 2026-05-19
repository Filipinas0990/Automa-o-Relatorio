import { pipeline } from './pipeline-fn';

pipeline()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
