import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { Document } from "langchain/document";
import fs from "fs";
import csv from "csv-parser";

const textbookPath = "Ocular Traumatology.pdf";
const abstractsPath = "oculartrauma_abstracts_c.csv";

const processChunks = (docs: Document[]): Document[] => {
  let result: Document[] = [];
  let currentChunk = "";
  let currentMetadata = {};

  for (let doc of docs) {
    if (currentChunk.length + doc.pageContent.length < 1000) {
      currentChunk += (currentChunk ? "\n\n" : "") + doc.pageContent;
      currentMetadata = { ...currentMetadata, ...doc.metadata };
    } else {
      if (currentChunk) {
        result.push(new Document({ pageContent: currentChunk, metadata: currentMetadata }));
      }
      currentChunk = doc.pageContent;
      currentMetadata = doc.metadata;
    }
  }

  if (currentChunk) {
    result.push(new Document({ pageContent: currentChunk, metadata: currentMetadata }));
  }

  return result;
};

const loadTextbook = async (): Promise<Document[]> => {
  if (!textbookPath) {
    console.log("No textbook path provided. Skipping textbook loading.");
    return [];
  }

  const loader = new PDFLoader(textbookPath);
  const docs = await loader.load();

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ["\n\n", "\n", " ", ""],
  });

  const splitDocs = await textSplitter.splitDocuments(docs);
  const processedDocs = processChunks(splitDocs);

  const textbookMetadata = {
    source_type: "textbook",
    title: "Ocular Traumatology",
    authors: "Ferenc Kuhn, Robert Morris, Viktoria Mester, C. Douglas Witherspoon",
    publication_date: "2023-08-28",
    publication_year: "2023",
  };

  return processedDocs.map(doc => ({
    ...doc,
    metadata: { ...doc.metadata, ...textbookMetadata },
  }));
};

const loadAbstracts = async (): Promise<Document[]> => {
  return new Promise((resolve, reject) => {
    const docs: Document[] = [];
    fs.createReadStream(abstractsPath)
      .pipe(csv())
      .on("data", (row) => {
        docs.push(
          new Document({
            pageContent: row.abstract,
            metadata: {
              source_type: "abstract",
              pmid: row.pmid,
              title: row.title,
              authors: row.authors,
              citation_count: row.citation_count,
              publication_date: row.publication_date,
            },
          })
        );
      })
      .on("end", () => {
        console.log(`Loaded ${docs.length} abstracts.`);
        resolve(docs);
      })
      .on("error", reject);
  });
};

const loadVectorDB = async (): Promise<void> => {
  console.log("Starting ingestion process...");

  // Check for required environment variables
  const requiredEnvVars = ['PINECONE_API_KEY', 'PINECONE_INDEX', 'OPENAI_API_KEY'];
  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}. Please set these in your .env.local file.`);
  }

  try {
    console.log("Initializing Pinecone client...");
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    console.log(`Accessing Pinecone index: ${process.env.PINECONE_INDEX}`);
    const index = pinecone.Index(process.env.PINECONE_INDEX!);

    let allDocs: Document[] = [];

    if (textbookPath) {
      console.log("Loading textbook...");
      const textbookDocs = await loadTextbook();
      console.log(`Loaded ${textbookDocs.length} chunks from the textbook.`);
      allDocs = [...textbookDocs];
    }

    console.log("Loading abstracts...");
    const abstractDocs = await loadAbstracts();
    console.log(`Loaded ${abstractDocs.length} abstracts.`);
    allDocs = [...allDocs, ...abstractDocs];

    console.log(`Total documents to be ingested: ${allDocs.length}`);

    if (allDocs.length === 0) {
      console.log("No documents to ingest. Exiting.");
      return;
    }

    console.log("Sample document metadata:", JSON.stringify(allDocs[0].metadata, null, 2));

    console.log("Ingesting documents into Pinecone...");
    const embeddings = new OpenAIEmbeddings({ modelName: "text-embedding-3-small" });

    await PineconeStore.fromDocuments(allDocs, embeddings, {
      pineconeIndex: index,
      maxConcurrency: 5,
    });

    console.log("Ingestion complete!");

    // Verify ingestion
    console.log("Verifying ingestion...");
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, { pineconeIndex: index });
    const results = await vectorStore.similaritySearch("ocular trauma", 1);
    console.log("Sample retrieved document:");
    console.log("Content:", results[0].pageContent.substring(0, 100) + "...");
    console.log("Metadata:", JSON.stringify(results[0].metadata, null, 2));

  } catch (error) {
    console.error("An error occurred:");
    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    } else {
      console.error(error);
    }
  }
};

loadVectorDB().catch((error) => {
  console.error("An unexpected error occurred:", error);
  process.exit(1);
});