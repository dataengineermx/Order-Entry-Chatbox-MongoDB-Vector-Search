/**
 * cargar_catalogo.js
 * Genera embeddings con Voyage AI e inserta el catálogo en MongoDB Atlas.
 *
 * Uso:
 *   1. npm install mongodb dotenv
 *   2. Crea un archivo .env con:
 *        MONGODB_URI=mongodb+srv://usuario:password@tucluster.mongodb.net/
 *        VOYAGE_API_KEY=tu_api_key_de_voyage
 *   3. node cargar_catalogo.js
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");
// Node.js 18+ incluye "fetch" de forma nativa, no se necesita node-fetch

const MONGODB_URI = process.env.MONGODB_URI;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const DB_NAME = "sales";
const COLLECTION = "products";

// Catálogo (mismos datos que el PDF/TXT que ya generamos)
const productos = require("./productos.json");

async function generarEmbeddingsEnLote(textos) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: textos, // arreglo con TODOS los textos, una sola petición
      model: "voyage-3-large",
      input_type: "document",
    }),
  });
  const data = await res.json();
  if (!data.data) throw new Error("Error generando embeddings: " + JSON.stringify(data));
  // data.data viene en el mismo orden que "textos"
  return data.data.map((d) => d.embedding);
}

function construirTextoEmbedding(p) {
  const otros = [];
  if (p.cafeina_mg > 0) otros.push(`Cafeína: ${p.cafeina_mg} mg`);
  if (p.taurina_mg > 0) otros.push(`Taurina: ${p.taurina_mg} mg`);
  return `${p.nombre}. Categoría: ${p.categoria}. Sabor: ${p.sabor}. ` +
    `Contenido neto: ${p.neto_ml} ml. Azúcares: ${p.azucares_g} g. ` +
    `Sodio: ${p.sodio_g} g. ${otros.join(", ")}. ${p.descripcion}`;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);

  console.log(`Generando embeddings para ${productos.length} productos en una sola petición...`);

  const textos = productos.map((p) => construirTextoEmbedding(p));
  const embeddings = await generarEmbeddingsEnLote(textos);

  console.log("Embeddings generados. Insertando en MongoDB...");

  for (let i = 0; i < productos.length; i++) {
    const p = productos[i];
    const texto_embedding = textos[i];
    const embedding = embeddings[i];

    await col.updateOne(
      { _id: p.sku },
      {
        $set: {
          ...p,
          _id: p.sku,
          texto_embedding,
          embedding,
        },
      },
      { upsert: true }
    );
    console.log(`✔ ${p.sku} - ${p.nombre}`);
  }

  console.log("Listo. Ahora crea el Vector Search Index en Atlas UI (ver instrucciones).");
  await client.close();
}

main().catch(console.error);
