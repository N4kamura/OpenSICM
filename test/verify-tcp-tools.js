/**
 * Verificación integral de herramientas de testing de GPS (Simulator y Send TCP)
 */
const { spawn } = require('child_process');
const mockAtu = require('./mock-atu-server');
const { server, start, shutdown } = require('../src/server');
const atuForwarder = require('../src/atu-forwarder');
const tcpIngest = require('../src/ingest/tcp-ingest');
const stateManager = require('../src/state-manager');

async function run() {
  console.log('--- Iniciando Mock ATU y OpenSICM Gateway para verificación ---');

  await new Promise((res, rej) => {
    mockAtu.server.listen(5000, () => {
      console.log('Mock ATU activo en puerto 5000');
      res();
    });
    mockAtu.server.on('error', rej);
  });

  await new Promise((res) => {
    start();
    setTimeout(res, 800);
  });

  // 1. Probar simulador con ciclo único
  console.log('\n--- 1. Probando simulator.js --once ---');
  await new Promise((res, rej) => {
    const p = spawn('node', ['simulator.js', '--once'], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`simulator.js salió con código ${code}`));
    });
  });

  // 2. Probar send-tcp-sample.js Suntech
  console.log('\n--- 2. Probando send-tcp-sample.js --protocol suntech ---');
  await new Promise((res, rej) => {
    const p = spawn('node', ['test/send-tcp-sample.js', '--protocol', 'suntech'], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`send-tcp-sample suntech falló con código ${code}`));
    });
  });

  // 3. Probar send-tcp-sample.js Teltonika
  console.log('\n--- 3. Probando send-tcp-sample.js --protocol teltonika ---');
  await new Promise((res, rej) => {
    const p = spawn('node', ['test/send-tcp-sample.js', '--protocol', 'teltonika'], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`send-tcp-sample teltonika falló con código ${code}`));
    });
  });

  // 4. Probar send-tcp-sample.js JSON
  console.log('\n--- 4. Probando send-tcp-sample.js --protocol json ---');
  await new Promise((res, rej) => {
    const p = spawn('node', ['test/send-tcp-sample.js', '--protocol', 'json'], { stdio: 'inherit' });
    p.on('exit', (code) => {
      if (code === 0) res();
      else rej(new Error(`send-tcp-sample json falló con código ${code}`));
    });
  });

  console.log('\n🎉 Todas las herramientas de testeo de GPS han sido verificadas exitosamente.');

  // Limpieza
  tcpIngest.stop();
  atuForwarder.stop();
  server.close();
  mockAtu.server.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Error durante la verificación:', err);
  process.exit(1);
});
