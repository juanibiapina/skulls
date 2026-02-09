import { join } from 'path';
import { homedir } from 'os';

/** Default installation directory for skills */
export const DEFAULT_SKILLS_DIR = join(homedir(), '.agents', 'skills');
