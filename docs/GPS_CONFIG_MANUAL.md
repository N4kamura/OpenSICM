# 📡 Manual Técnico: Conexión y Configuración de Equipos GPS Físicos a OpenSICM

Este manual describe el procedimiento detallado para instalar, programar y vincular dispositivos GPS vehiculares homologados por el MTC/ATU a la plataforma **OpenSICM**, asegurando que sus posiciones se reflejen en tiempo real en la interfaz web y se transmitan conforme a la normativa oficial de la **ATU**.

---

## 1. Arquitectura de Transmisión

```
[ GPS Físico en Bus ]
        │  (Chip Celular SIM GPRS / 4G)
        ▼  Cada 30s vía TCP Puerto 5001
[ VPS: OpenSICM Gateway ]
        │
        ├──► 1. Servidor TCP recibe IMEI y coordenadas en bruto.
        ├──► 2. Mapea el IMEI con la Placa, Ruta y Padrón en la base SQLite.
        ├──► 3. Calcula Odometría (Haversine), Horas Motor y Alertas de Blackout.
        │
        ├──► 4. Muestra la unidad en vivo en el Mapa Leaflet (Web Dashboard).
        │
        └──► 5. Normaliza y transmite JSON oficial hacia el WebSocket de la ATU cada 30s.
                                │
                                ▼
                       [ Servidor ATU SICM ] ──(Responde ACK)──► [ Confirmación Oficial ]
```

---

## 2. Equipos GPS Homologados Soportados

OpenSICM cuenta con decodificadores nativos para los protocolos más utilizados en el transporte urbano de Lima y Callao:

| Fabricante | Modelos | Protocolo Soportado | Puerto TCP | Notas de Hardware |
| :--- | :--- | :--- | :--- | :--- |
| **Teltonika** | FMB920, FMC130, FMB120, FMC920 | **Codec 8 / Codec 8 Extended** | `5001` | Estándar de alta fidelidad. Envía confirmación ACK binaria automática requerida por Teltonika. |
| **Suntech** | ST310U, ST340, ST3300, ST300 | **ASCII (ST300STT)** | `5001` | Ampliamente utilizado en Lima. Parser de tramas alfanuméricas con estado de ignición ACC. |
| **Queclink** | GV300, GV300W, GV55 | **Protocolo @Track** | `5001` | Parser nativo o reenvío REST vía `POST /api/telemetria`. |
| **Concox / Coban** | GT06N, WeTrack2, TK103 | **GT06 Protocol** | `5001` | Equipos genéricos económicos comunes en flotas urbanas. |
| **Cualquier marca** | Dispositivos con API / Webhook | **REST JSON** | `3000` / `443` | `POST /api/telemetria` con el formato JSON estándar. |

---

## 3. Parámetros de Red para la Configuración del GPS

Todos los equipos físicos instalados en los buses deben programarse con los siguientes parámetros de comunicación:

### 3.1. Destino del Servidor
* **Dirección IP del Servidor:** `IP_PUBLICA_DE_TU_VPS` (o tu subdominio, ej. `gps.tuempresa.com.pe`).
* **Puerto:** `5001`
* **Protocolo de Transporte:** `TCP` *(Recomendado para transporte urbano por control de entrega y fiabilidad)*.

### 3.2. Configuración APN (Operadores Móviles de Perú)
Según el operador de la tarjeta SIM insertada en el GPS:

| Operador | APN | Usuario | Contraseña |
| :--- | :--- | :--- | :--- |
| **Claro Perú** | `claro.pe` | `claro` | `claro` |
| **Movistar Perú** | `movistar.pe` | `movistar@datos` | `movistar` |
| **Entel Perú** | `entel.pe` | `entel` | `entel` |
| **Bitel Perú** | `bitel` | `bitel` | `bitel` |

### 3.3. Tiempos de Reporte (Norma ATU)
* **Con Motor Encendido (ACC = ON):** **`30 segundos`** *(Frecuencia estricta exigida por la directiva técnica de la ATU)*.
* **Con Motor Apagado (ACC = OFF):** **`300 segundos`** *(5 minutos, para preservar la batería del vehículo)*.
* **Giro de Curva (Ángulo):** Cada $30^\circ$ de cambio de dirección.

---

## 4. Ejemplos de Programación de GPS Físicos

### Caso A: Suntech (Modelos ST310U / ST340)

Se puede configurar conectando el cable serial de datos o enviando comandos vía mensaje SMS desde un teléfono autorizado hacia el número del chip del GPS:

1. **Configurar APN (Ejemplo Claro):**
   ```text
   ST300CMD;{IMEI};02;Network;claro.pe;claro;claro;
   ```
2. **Configurar Servidor y Puerto TCP:**
   ```text
   ST300CMD;{IMEI};02;Preset;1;{IP_DE_TU_VPS};5001;;;;
   ```
3. **Configurar Intervalos de Transmisión (30s encendido, 300s apagado):**
   ```text
   ST300CMD;{IMEI};02;Time;30;300;
   ```
4. **Reiniciar Módem:**
   ```text
   ST300CMD;{IMEI};02;Reboot;
   ```

---

### Caso B: Teltonika (Modelos FMB920 / FMC130)

#### Opción 1: Mediante Teltonika Configurator (Cable USB en Taller):
1. Conectar el equipo por micro-USB a la PC y abrir **Teltonika Configurator**.
2. En la pestaña **GPRS**:
   * **APN:** `claro.pe` (o tu operador) / Usuario y Contraseña correspondientes.
   * **Server Settings:**
     * Domain: `IP_DE_TU_VPS`
     * Port: `5001`
     * Protocol: `TCP`
     * Data Protocol: `Codec 8`
3. En la pestaña **Data Acquisition**:
   * **On Stop (Detenido):** Min Period: `300s`.
   * **On Moving (En movimiento):** Min Period: `30s`, Min Angle: `30°`.
4. Guardar configuración en el dispositivo (**Save to device**).

#### Opción 2: Mediante Comandos SMS:
Enviar el siguiente SMS al chip del equipo:
```text
  setparam 2001:IP_DE_TU_VPS;2002:5001;2003:0;2004:claro.pe;2005:claro;2006:claro;10000:30;10001:300
```
*(Nota: Teltonika suele requerir dos espacios al inicio si no se tiene configurada contraseña SMS).*

---

## 5. Procedimiento Paso a Paso para Conectar el GPS a la Web de OpenSICM

Una vez que el equipo GPS físico está instalado en el bus:

### Paso 1: Instalación Eléctrica en el Vehículo
1. **Cable Rojo (+12V / +24V):** Conectar a positivo directo de batería (alimentación continua).
2. **Cable Negro (GND / Tierra):** Conectar a chasis del vehículo.
3. **Cable Blanco o Amarillo (ACC / Ignición):** Conectar a la línea de contacto de la llave de encendido del motor. 
   > ⚠️ **Muy importante:** La ATU sanciona si no se transmite el estado de la ignición (`ignicion = 1`). Este cable le indica a OpenSICM si el bus está en operación o detenido.
4. **Antena GPS:** Debe instalarse en el tablero o parabrisas orientada hacia el cielo, sin láminas metálicas bloqueando la vista satelital.

---

### Paso 2: Dar de Alta la Unidad en el Dashboard Web
1. Abre tu navegador e ingresa a OpenSICM (`https://gps.tuempresa.com.pe` o `http://localhost:3000`).
2. Haz clic en la pestaña **"Flota y Asignación GPS"** en la barra superior.
3. Haz clic en el botón verde **"+ Agregar Unidad"**.
4. Completa la ficha de la unidad:
   * **Placa:** 6 caracteres en mayúsculas sin guiones (ej. `A1B789`).
   * **Código de Ruta ATU:** Tu ruta concesionada (ej. `OM09`).
   * **Padrón Interno:** Número económico de la empresa (ej. `12`).
   * **Modelo de GPS:** Selecciona el fabricante instalado (ej. `TELTONIKA_FMB920` o `SUNTECH_ST310`).
   * **IMEI del Módem:** Los **15 dígitos numéricos** que figuran en la etiqueta física del equipo GPS.
5. Haz clic en **"Guardar Unidad"**.

---

### Paso 3: Encendido y Verificación de Recepción en Tiempo Real
1. Enciende el motor del vehículo o activa el contacto ($\text{ACC} = \text{ON}$).
2. Espera de 1 a 2 minutos mientras el módem toma señal de red y engancha satélites GPS (luces LED fijas o parpadeo lento en el equipo).
3. En la pestaña **"Mapa en Vivo"** de OpenSICM:
   * Aparecerá de inmediato el marcador del bus centrado en su ubicación real.
   * El color del icono cambiará a:
     * 🟢 **Verde:** Si el bus está circulando a más de $5\text{ km/h}$.
     * 🟡 **Amarillo:** Si el bus tiene motor encendido pero está detenido.
   * Haz clic sobre el bus para abrir su popup y verificar:
     * **Placa:** `A1B789`
     * **Velocidad y Rumbo**
     * **Estado ATU:** `CONFIRMADO` (con check verde)
4. En la barra superior:
   * Verás subir el contador de **Enviadas** y **ACK ATU** cada 30 segundos conforme el bus avance.

---

### Paso 4: Certificación Previa en Taller con el "Banco de Pruebas ATU"
Antes de enviar el bus a la calle a recoger pasajeros, certifica su enlace con la ATU:
1. En OpenSICM, ingresa a la pestaña **"Banco de Pruebas ATU"**.
2. En el menú desplegable **"Seleccionar Unidad Registrada"**, elige la placa del bus recién configurado.
3. El sistema bloqueará automáticamente la Placa, Ruta e IMEI con candado (`🔒`) para garantizar que la prueba coincida con el inventario registrado.
4. Presiona **"Transmitir Trama de Prueba a ATU"**.
5. Revisa la caja de diagnóstico inferior:
   * Si la respuesta es `ACK`: La ATU reconoce tu token de empresa, la placa y la ruta. **La unidad está lista para circular.**
   * Si la respuesta es un error: Podrás ver el motivo exacto (ej. *"Placa no registrada en concesión"*) y corregirlo en minutos antes de que el bus opere y reciba una sanción electrónica.

---

## 6. Comprobación desde Terminal (CLI)

Si deseas verificar que el puerto de ingesta `5001` esté recibiendo paquetes sin tener el bus presente, puedes emular una trama física real con la herramienta CLI incluida:

```bash
# Probar con trama ASCII Suntech
node test/send-tcp-sample.js --protocol suntech --imei 864201041234561

# Probar con trama binaria Teltonika Codec 8
node test/send-tcp-sample.js --protocol teltonika --imei 864201041234561
```
El gateway procesará el paquete en el puerto `5001`, resolverá el IMEI hacia la placa correspondiente y lo transmitirá al receptor ATU con respuesta ACK inmediata.

---

## 7. Solución de Problemas Frecuentes (Troubleshooting)

### Problema 1: El bus no aparece en el mapa y no envía datos
* **Causa A (Firewall):** En el servidor VPS, el puerto `5001/TCP` está cerrado.
  * *Solución:* Ejecuta `ufw allow 5001/tcp && ufw reload` en la consola de Linux.
* **Causa B (Chip sin saldo o APN incorrecto):** La tarjeta SIM no tiene plan de datos activo o el APN no fue configurado.
  * *Solución:* Verifica el APN con el operador móvil (`claro.pe`, `movistar.pe`, etc.) y confirma que la SIM tenga datos habilitados.
* **Causa C (IMEI no coincide):** El IMEI registrado en la web tiene un dígito incorrecto.
  * *Solución:* Revisa en *Flota y Asignación GPS* que los 15 dígitos coincidan exactamente con la etiqueta física del equipo.

### Problema 2: El bus aparece como "OFFLINE" (Rojo) a pesar de estar encendido
* **Causa:** El cable de ignición (ACC) no fue conectado al switch de contacto del vehículo o está suelto.
* *Solución:* Revisa la conexión del cable blanco/amarillo del arnés del GPS al circuito de la llave de contacto del bus.

### Problema 3: Las tramas se acumulan "En Cola" y no sube "ACK ATU"
* **Causa:** El Gateway no tiene conexión a internet o el servidor oficial de la ATU está caído/en mantenimiento.
* *Solución:* OpenSICM guardará hasta 10,000 posiciones en disco y las despachará automáticamente en orden cuando el enlace con la ATU se restablezca.
