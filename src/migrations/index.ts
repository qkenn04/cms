import * as migration_20260925_031236_init from './20260925_031236_init';
import * as migration_20260925_032453_content_model from './20260925_032453_content_model';

export const migrations = [
  {
    up: migration_20260925_031236_init.up,
    down: migration_20260925_031236_init.down,
    name: '20260925_031236_init',
  },
  {
    up: migration_20260925_032453_content_model.up,
    down: migration_20260925_032453_content_model.down,
    name: '20260925_032453_content_model'
  },
];
