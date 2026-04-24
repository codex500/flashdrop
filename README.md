# FlashDrop Backend (Relay Server)

This is the standard backend server for FlashDrop, inspired by AirDrop. It handles device discovery via WebSocket and relays actual files through the server via temporary storage. 

Files are uploaded to an `uploads/` directory, streamed to the receiving device, and immediately deleted off the disk to preserve privacy and storage space.

## Table of Contents
- [Tech Stack](#tech-stack)
- [Installation & Running](#installation--running)
- [REST API Endpoints](#rest-api-endpoints)
- [WebSocket Events](#websocket-events)
- [Security Features](#security-features)

## Tech Stack
- **Node.js** & **Express**
- **Socket.io** (Real-time device discovery and progress relay)
- **Multer** (Handling `multipart/form-data` file uploads)
- **UUID** (Session and device identification)

## Installation & Running

```bash
# Install dependencies
npm install

# Start development server (auto-reloads on changes)
npm run dev

# Start production server
npm start
```
The server runs on `http://localhost:3001` by default. You can override this by creating a `.env` file (see `.env.example`).

---

## REST API Endpoints

### 1. Upload File
**POST** `/upload`
Accepts `multipart/form-data`. Uploads a file to the server for a specific recipient.

**Form Fields:**
- `file` (File): The file being transferred (Max 500MB).
- `sessionId` (String): The UUID of the current session.
- `targetDeviceId` (String): The UUID of the device that will receive the file.

**Success Response (200 OK):**
```json
{
  "fileId": "uuid-string.ext",
  "originalName": "image.png",
  "fileSize": 1048576,
  "mimeType": "image/png",
  "sessionId": "session-uuid",
  "targetDeviceId": "target-uuid",
  "downloadUrl": "/download/uuid-string.ext"
}
```

### 2. Download File
**GET** `/download/:fileId`
Streams the requested file to the client. The file is **automatically deleted** from the disk as soon as the download finishes.

### 3. Get Session Devices
**GET** `/devices?sessionId={sessionId}`
Returns a list of all devices currently active in the given session.

**Success Response (200 OK):**
```json
{
  "sessionId": "session-uuid",
  "devices": [
    {
      "deviceId": "device-uuid",
      "deviceName": "iPhone",
      "joinedAt": 1709573820000
    }
  ]
}
```

### 4. Generate QR Code
**GET** `/qr?sessionId={sessionId}&baseUrl={optionalUrl}`
Returns a Base64 encoded QR Code image data URL that clients can use to join the session.

**Success Response (200 OK):**
```json
{
  "sessionId": "session-uuid",
  "url": "http://localhost:5173?session=session-uuid",
  "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}
```

### 5. Health Check
**GET** `/health`
Returns the server status.

---

## WebSocket Events

Connnect to the WebSocket namespace `/` using Socket.io.

### Client-to-Server Events (Emit)

1. **`connect-device`**
   - Payload: `{ sessionId?: string, deviceName?: string }`
   - Description: Registers the device in a session. If `sessionId` is omitted, a new one is generated.

2. **`send-file`**
   - Payload: `{ targetDeviceId: string, fileId: string, fileName: string, fileSize: number, mimeType: string }`
   - Description: Emitted **after** a successful HTTP `/upload`. Notifies the target device that a file is ready to download.

3. **`transfer-status`**
   - Payload: `{ targetDeviceId: string, fileId: string, status: "accepted" | "declined" | "downloading" | "done", progress: number }`
   - Description: Relays the download progress or acceptance status back to the sender. If `status` is `"done"` or `"declined"`, the server immediately deletes the file.

### Server-to-Client Events (Listen)

1. **`device-joined`**
   - Payload: `{ device: { deviceId, deviceName }, sessionId }`
   - Description: Sent back to the connecting client to provide them their assigned IDs.

2. **`device-list`**
   - Payload: `[{ deviceId, deviceName, joinedAt }]`
   - Description: Broadcasted to all users in a session whenever someone joins or leaves.

3. **`device-left`**
   - Payload: `{ deviceId, deviceName }`
   - Description: Broadcasted when a user disconnects.

4. **`receive-file`**
   - Payload: `{ from: string, fromName: string, fileId: string, fileName: string, fileSize: number, mimeType: string, downloadUrl: string }`
   - Description: Alerts a device that someone is trying to send them a file.

5. **`transfer-status`**
   - Payload: `{ fileId: string, status: string, progress: number }`
   - Description: Real-time progress updates sent to the sender of a file.

6. **`error`**
   - Payload: `{ message: string }`
   - Description: Emitted if a security check fails (e.g., trying to send a file to a device in a different session).

---

## Security Features
1. **Zero Persistence:** Files are deleted immediately after download, or automatically after 10 minutes if left orphaned.
2. **Session Isolation:** Socket events verify that the Sender and Target device belong to the exact same Session UUID before transferring data.
3. **Hard Size Limits:** Multer prevents any upload larger than 500MB from being written to disk.
4. **Path Traversal Guards:** Downloads strip path information to prevent directory traversal attacks (`../../../etc/passwd`).
