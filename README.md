# Chatbot de Pedidos de Bebidas — Demo MongoDB Atlas Vector Search

## Requisitos previos
- Cuenta de MongoDB Atlas con un cluster (M0 gratuito sirve).
- Cuenta gratuita en [Voyage AI](https://www.voyageai.com) (200M tokens gratis, para embeddings).
- Cuenta gratuita en [Groq](https://console.groq.com) (para el LLM que redacta las respuestas).
- Node.js 18+ instalado.

## Pasos

### 1. Instalar dependencias
```bash
npm install express mongodb dotenv cors
```

### 2. Configurar variables de entorno
Copia `.env.example` a `.env` y llena tus credenciales:
```bash
cp .env.example .env
```

### 3. Crear el Vector Search Index en Atlas
En Atlas UI → tu cluster → **Atlas Search** → **Create Search Index** →
**Atlas Vector Search** → **JSON Editor**. Usa la base `sales`,
colección `products`, nombre de índice `vector_index_bebidas`, y pega
el contenido de `vector_index_definition.json`.

### 4. Cargar el catálogo con embeddings
```bash
node cargar_catalogo.js
```
Esto genera un embedding por producto (usando Voyage AI) y los inserta
como documentos JSON en la colección `products` de tu base `sales`.
**No se pega ningún archivo de texto directamente en la colección** — el
`.txt`/PDF solo sirve para el Chatbot Demo Builder (playground standalone).
Tu colección real recibe documentos estructurados con su campo `embedding`.

### 5. Levantar el backend
```bash
node server.js
```
Corre en `http://localhost:3000`.

### 6. Abrir el frontend
Sirve la carpeta `public` con un servidor estático (recomendado, evita problemas
de caché/CORS de abrir el archivo directo):
```bash
cd public
python3 -m http.server 8080
```
Abre `http://localhost:8080` en tu navegador. Prueba mensajes como:
- "¿Qué bebidas sin azúcar tienen?"
- "Recomiéndame algo con cafeína para el trabajo"

### 7. Probar el flujo de pedido
Cada producto sugerido por el bot aparece como una "chip" con un botón
**"+ Agregar"**. Al hacer clic, se agrega a un carrito visible arriba del
campo de texto. Desde ahí puedes:
- **Confirmar pedido**: lo guarda en la colección `pedidos` (vía `/api/pedido`).
- **Vaciar**: limpia el carrito sin guardar nada.
- **Mis pedidos** (botón en el encabezado): consulta el historial de pedidos
  confirmados de la sesión actual (vía `/api/pedidos/:sesionId`).

## Arquitectura para explicar en la entrevista

1. **Catálogo → embeddings → Atlas Vector Search**: cada producto se
   convierte en un vector de 1024 dimensiones (Voyage AI voyage-3-large)
   y se indexa con `$vectorSearch` para recuperación semántica.
2. **LLM (Groq, gratuito)**: redacta la respuesta en lenguaje natural
   usando solo los productos recuperados como contexto (RAG).
3. **Pedidos**: colección separada, transaccional, sin vector search —
   demuestra que sabes cuándo SÍ y cuándo NO usar búsqueda semántica.
4. **Filtro híbrido**: el índice incluye `categoria` como campo de filtro,
   permitiendo combinar `$vectorSearch` con condiciones exactas.

## Costos
Todo el stack se mantiene en $0 dentro de los límites gratuitos:
- Atlas M0: gratis permanente.
- Voyage AI: 200M tokens gratis (este catálogo usa unos pocos miles).
- Groq: free tier con límite de requests por minuto, suficiente para una demo.
