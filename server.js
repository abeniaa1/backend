import express from "express";
import { MongoClient } from "mongodb"; // Remove Binary import
import dotenv from "dotenv";
import mime from "mime-types";
import path from "path";
import { fileURLToPath } from 'url';

// Fix for ES modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' })); // Reduce JSON limit

// Remove heavy middleware for cPanel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const port = process.env.PORT || 3000;

let db, filesCollection, metadataCollection;

// Lightweight connection
async function connectDB() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      maxPoolSize: 1, // Reduce connection pool
      minPoolSize: 0
    });
    
    await client.connect();
    db = client.db(dbName);
    filesCollection = db.collection("files");
    metadataCollection = db.collection("backup_metadata");
    
    console.log(`✅ Connected to MongoDB: ${dbName}`);
    return client;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    // Don't exit - allow server to start without DB
    return null;
  }
}

// --- LIGHTWEIGHT ROUTES ---

// 1️⃣ List all backups (with pagination)
app.get("/backups", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const backups = await metadataCollection
      .find({}, {
        projection: { backup_id: 1, backup_name: 1, timestamp: 1, total_size: 1, _id: 0 }
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      count: backups.length,
      backups: backups
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch backups"
    });
  }
});

// 2️⃣ List files for a specific backup (with pagination)
app.get("/backups/:id/files", async (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 100;

  try {
    const files = await filesCollection
      .find(
        {
          backup_id: id,
          is_directory: { $ne: true }
        },
        {
          projection: {
            _id: 0,
            relative_path: 1,
            file_size: 1,
            filename: 1
          }
        }
      )
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      backup_id: id,
      count: files.length,
      files: files
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch files"
    });
  }
});

// 2.5️⃣ List backups for downloads (id, name, timestamp)
app.get("/downloads", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const backups = await metadataCollection
      .find({}, {
        projection: { backup_id: 1, backup_name: 1, timestamp: 1, _id: 0 }
      })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    res.json({
      success: true,
      count: backups.length,
      backups: backups
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch downloads"
    });
  }
});

// 3️⃣ Download a single file (streaming for large files)
app.get("/download/:backupId/*", async (req, res) => {
  const { backupId } = req.params;
  const relativePath = decodeURIComponent(req.params[0]);

  try {
    // Find file document first
    const fileDoc = await filesCollection.findOne({
      backup_id: backupId,
      relative_path: relativePath,
      is_chunked: { $ne: true },
    });

    if (fileDoc && fileDoc.content) {
      const fileBuffer = Buffer.from(fileDoc.content.buffer);
      const mimeType = mime.lookup(fileDoc.filename) || "application/octet-stream";
      
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileDoc.filename}"`);
      return res.send(fileBuffer);
    }

    res.status(404).json({ 
      success: false,
      error: "File not found"
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: "Failed to download file"
    });
  }
});

// 4️⃣ Lightweight health check
app.get("/health", async (req, res) => {
  try {
    if (db) {
      await db.command({ ping: 1 });
      res.json({
        success: true,
        status: "healthy",
        database: "connected"
      });
    } else {
      res.json({
        success: true,
        status: "healthy", 
        database: "disconnected"
      });
    }
  } catch (error) {
    res.json({
      success: true,
      status: "healthy",
      database: "error"
    });
  }
});

// 5️⃣ Minimal root route
app.get("/", (req, res) => {
  res.json({
    message: "📦 MongoDB File Server",
    status: "running",
    memory: "optimized"
  });
});

// Start server with error handling
connectDB().then((client) => {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port} (Memory Optimized)`);
  });
}).catch(error => {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port} (DB Connection Failed)`);
  });
});