import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, ChatMessage } from "@langchain/core/messages";
import type { Message as VercelChatMessage } from "ai";
import { loadEmbeddingsModel, loadVectorStore } from "@/utils/pinecone";
import { createRAGChain } from "@/utils/ragChain";
import { Document } from "@langchain/core/documents";

const formatVercelMessages = (message: VercelChatMessage) => {
  if (message.role === "user") {
    return new HumanMessage(message.content);
  } else if (message.role === "assistant") {
    return new AIMessage(message.content);
  } else {
    console.warn(
      `Unknown message type passed: "${message.role}". Falling back to generic message type.`
    );
    return new ChatMessage({ content: message.content, role: message.role });
  }
};

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body.messages ?? [];

    if (!messages.length) {
      throw new Error("No messages provided.");
    }

    const formattedPreviousMessages = messages
      .slice(0, -1)
      .map(formatVercelMessages);

    const currentMessage = messages[messages.length - 1].content;

    const chatModel = new ChatOpenAI({
      modelName: "gpt-4o",
      streaming: true,
      maxTokens: 4000,
    });

    const embeddings = loadEmbeddingsModel();

    const vectorstore = loadVectorStore({
      //   namespace
      embeddings,
    });

    let resolveWithDocuments: (value: Document[]) => void;
    const documentPromise = new Promise<Document[]>((resolve) => {
      resolveWithDocuments = resolve;
    });

    const retriever = (await vectorstore).asRetriever({
      k: 10,
      callbacks: [
        {
          handleRetrieverEnd(documents) {
            resolveWithDocuments(documents);
          },
        },
      ],
    });

    const ragChain = await createRAGChain(chatModel, retriever);

    const stream = await ragChain.stream({
      input: currentMessage,
      chat_history: formattedPreviousMessages,
    });

    const documents = await documentPromise;
    const serializedSources = Buffer.from(
      JSON.stringify(
        documents.map((doc) => {
          return {
            pageContent: doc.pageContent,
            metadata: doc.metadata,
          };
        })
      )
    ).toString("base64");

    // Convert to bytes so that we can pass into the HTTP response
    const byteStream = stream.pipeThrough(new TextEncoderStream());

    return new Response(byteStream, {
      headers: {
        "x-message-index": (formattedPreviousMessages.length + 1).toString(),
        "x-sources": serializedSources,
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}