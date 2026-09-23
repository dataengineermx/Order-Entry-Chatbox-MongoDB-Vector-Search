/**
 * server.js
 * Backend de la demo: chatbot de pedidos de bebidas con MongoDB Atlas Vector Search.
 *
 * npm install express mongodb dotenv cors
 * node server.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
// Node.js 18+ incluye "fetch" de forma nativa, no se necesita node-fetch

const app = express();
app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY; // LLM gratuito para generar respuestas

let db;

async function conectarMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db("sales");
  console.log("Conectado a MongoDB Atlas");
}

// ---------- Embeddings (Voyage AI) ----------
async function generarEmbeddingConsulta(texto) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [texto],
      model: "voyage-3-large",
      input_type: "query",
    }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

// ---------- Vector Search en Atlas ----------
async function buscarProductosRelevantes(embedding, limite = 4) {
  return db
    .collection("products")
    .aggregate([
      {
        $vectorSearch: {
          index: "vector_index_bebidas",
          path: "embedding",
          queryVector: embedding,
          numCandidates: 100,
          limit: limite,
        },
      },
      {
        $project: {
          embedding: 0,
          texto_embedding: 0,
          _id: 0,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ])
    .toArray();
}

// ---------- LLM gratuito (Groq) para redactar la respuesta ----------
async function generarRespuestaLLM(pregunta, productosContexto) {
  const contexto = productosContexto
    .map(
      (p) =>
        `- ${p.nombre} (SKU ${p.sku}): ${p.categoria}, sabor ${p.sabor}, ` +
        `${p.neto_ml}ml, ${p.azucares_g}g azúcar, ${p.sodio_g}g sodio. ${p.descripcion}`
    )
    .join("\n");

  const prompt = `Eres el asistente de Bebidas Valentino, una tienda de bebidas. Responde la pregunta del cliente
usando SOLO la información de este catálogo. Sé breve y conversacional.

Catálogo relevante:
${contexto}

Pregunta del cliente: ${pregunta}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!data.choices) {
    console.error("Respuesta de Groq sin 'choices':", JSON.stringify(data));
    throw new Error("Error de Groq: " + (data.error?.message || JSON.stringify(data)));
  }
  return data.choices[0].message.content;
}

// ---------- Detección simple de intención de pedido ----------
const PALABRAS_PEDIDO = ["quiero", "dame", "agregar", "pedir", "ordenar", "llevame", "añade"];
const CATALOGO_KEYWORDS = {
  agua: "Agua",
  refresco: "Refresco",
  jugo: "Jugo",
  energizante: "Energizante",
  deportiva: "Deportiva",
};

function pareceIntencionDePedido(mensaje) {
  const m = mensaje.toLowerCase();
  return PALABRAS_PEDIDO.some((palabra) => m.includes(palabra));
}

// ---------- Endpoint principal del chat ----------
app.post("/api/chat", async (req, res) => {
  try {
    const { mensaje, sesionId } = req.body;
    if (!mensaje || !sesionId) {
      return res.status(400).json({ error: "Faltan 'mensaje' o 'sesionId'" });
    }

    // 1. Vector search sobre el catálogo
    const embedding = await generarEmbeddingConsulta(mensaje);
    const productosRelevantes = await buscarProductosRelevantes(embedding);

    // 2. Generar respuesta conversacional con el LLM
    const respuestaTexto = await generarRespuestaLLM(mensaje, productosRelevantes);

    // 3. Si detectamos intención de pedido, sugerimos confirmar (lógica simple)
    const esPedido = pareceIntencionDePedido(mensaje);

    res.json({
      respuesta: respuestaTexto,
      productos_sugeridos: productosRelevantes,
      intencion_pedido: esPedido,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error procesando el mensaje" });
  }
});

// ---------- Endpoint para confirmar un pedido ----------
app.post("/api/pedido", async (req, res) => {
  try {
    const { sesionId, items } = req.body; // items: [{ sku, cantidad }]
    if (!sesionId || !items || !items.length) {
      return res.status(400).json({ error: "Faltan 'sesionId' o 'items'" });
    }

    const skus = items.map((i) => i.sku);
    const productos = await db
      .collection("products")
      .find({ sku: { $in: skus } })
      .toArray();

    const itemsConPrecio = items.map((item) => {
      const prod = productos.find((p) => p.sku === item.sku);
      return {
        sku: item.sku,
        nombre: prod ? prod.nombre : item.sku,
        cantidad: item.cantidad,
      };
    });

    const pedido = {
      usuario: sesionId,
      items: itemsConPrecio,
      estado: "pendiente",
      fecha: new Date(),
    };

    const resultado = await db.collection("pedidos").insertOne(pedido);
    res.json({ ok: true, pedidoId: resultado.insertedId, pedido });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error creando el pedido" });
  }
});

// ---------- Endpoint para ver pedidos de una sesión ----------
app.get("/api/pedidos/:sesionId", async (req, res) => {
  const pedidos = await db
    .collection("pedidos")
    .find({ usuario: req.params.sesionId })
    .sort({ fecha: -1 })
    .toArray();
  res.json(pedidos);
});

const PORT = process.env.PORT || 3000;
conectarMongo().then(() => {
  app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
});
