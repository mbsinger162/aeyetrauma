import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { BaseRetriever } from "@langchain/core/retrievers";
import type { Runnable } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";

const historyAwarePrompt = ChatPromptTemplate.fromMessages([
  new MessagesPlaceholder("chat_history"),
  ["user", "{input}"],
  [
    "user",
    "Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.",
  ],
]);

const ANSWER_SYSTEM_TEMPLATE = `You are an ocular trauma expert providing advice to other providers. Use the following pieces of context to answer the question at the end.
    Be as thorough as possible with your answers. Think it out step by step. Explain your reasoning.
    If you don't know the answer, just say you don't know. DO NOT try to make up an answer.
    If the question is not related to the context, politely respond that you are tuned to only answer questions that are related to the context.
      
      <context>
      {context}
      </context>
      
      Please return your answer in markdown with clear headings and lists.`;

const answerPrompt = ChatPromptTemplate.fromMessages([
  ["system", ANSWER_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("chat_history"),
  ["user", "{input}"],
]);

export async function createRAGChain(
  chatModel: BaseLanguageModel,
  retriever: BaseRetriever
): Promise<Runnable<{ input: string; chat_history: BaseMessage[] }, string>> {
  const historyAwareRetrieverChain = await createHistoryAwareRetriever({
    llm: chatModel,
    retriever,
    rephrasePrompt: historyAwarePrompt,
  });

  const documentChain = await createStuffDocumentsChain({
    llm: chatModel,
    prompt: answerPrompt,
  });

  const conversationalRetrievalChain = await createRetrievalChain({
    retriever: historyAwareRetrieverChain,
    combineDocsChain: documentChain,
  });

  // "Pick" the answer from the retrieval chain output object.
  return conversationalRetrievalChain.pick("answer");
}
