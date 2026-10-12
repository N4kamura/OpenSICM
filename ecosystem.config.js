/**
 * OpenSICM - Archivo de Configuración de Producción para PM2
 * Estándar de la industria para despliegue de procesos Node.js en servidores Linux/VPS.
 *
 * Comandos de uso:
 *   pm2 start ecosystem.config.js --env production  # Iniciar Gateway en segundo plano
 *   pm2 restart opensicm-gateway                   # Reiniciar proceso limpiamente
 *   pm2 stop opensicm-gateway                      # Detener proceso
 *   pm2 logs opensicm-gateway                      # Visualizar logs en tiempo real
 *   pm2 monit                                      # Tablero en consola de CPU/RAM
 *   pm2 save && pm2 startup                        # Configurar auto-inicio en arranque de Linux
 */
module.exports = {
  apps: [
    {
      name: 'opensicm-gateway',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1, // 1 sola instancia requerida para mantener sesión persistente de WebSocket hacia ATU
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000, // Margen de 5s para cierre graceful (guardado de SQLite y desconexión limpia)
      listen_timeout: 8000
    }
  ]
};
