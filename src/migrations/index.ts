import * as migration_20260925_031236_init from './20260925_031236_init';

export const migrations = [
  {
    up: migration_20260925_031236_init.up,
    down: migration_20260925_031236_init.down,
    name: '20260925_031236_init'
  },
];
