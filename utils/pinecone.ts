import { OpenAIEmbeddings } from '@langchain/openai';
import { PineconeStore } from '@langchain/pinecone';
import { Pinecone } from '@pinecone-database/pinecone';
import { Embeddings } from '@langchain/core/embeddings';
import dotenv from 'dotenv';

// Load environment variables from .env.local
// dotenv.config({ path: '.env.local' });

const pinecone = new Pinecone();
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX!);

export function loadEmbeddingsModel() {
  return new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    modelName: 'text-embedding-3-small',
  });
}

export async function loadVectorStore({
  // namespace,
  embeddings,
}: {
  // namespace: string;
  embeddings: Embeddings;
}) {
  return PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    // namespace,
    textKey: 'text',
  });
}