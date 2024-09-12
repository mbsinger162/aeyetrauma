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

    If prompted about the ocular trauma score (OTS) please refer to the following scoring system below:
    A. Initial raw score (based on visual acuity): 60 if no light perception (NLP); 70 if light perception (LP) or hand motion (HM); 80 if 1/200 to 19/200; 90 if 20/200 to 20/50; 100 if better or equal to 20/40
    B. if globe rupture subtract 23
    C. if endophthalmitis subtract 17
    D. if perforating injury subtract 14
    E. if retinal detachment subtract 11
    F. ir relative afferent pupillary defect (RAPD) subtract 10
    
    For OTS: estimated probability of follow-up visual acuity at 6 months is as below:
    1.	Raw Score Sum: 0 to 44, OTS Score: 1, NLP: 73%, LP/HM: 17%, 1/200 to 19/200: 7%, 20/200 to 20/50: 2%, ≥20/40: 1%
    2.	Raw Score Sum: 45 to 65, OTS Score: 2, NLP: 28%, LP/HM: 26%, 1/200 to 19/200: 18%, 20/200 to 20/50: 13%, ≥20/40: 15%
    3.	Raw Score Sum: 66 to 80, OTS Score: 3, NLP: 2%, LP/HM: 11%, 1/200 to 19/200: 15%, 20/200 to 20/50: 28%, ≥20/40: 44%
    4.	Raw Score Sum: 81 to 91, OTS Score: 4, NLP: 1%, LP/HM: 2%, 1/200 to 19/200: 2%, 20/200 to 20/50: 21%, ≥20/40: 74%
    5.	Raw Score Sum: 90 to 100, OTS Score: 5, NLP: 0%, LP/HM: 1%, 1/200 to 19/200: 2%, 20/200 to 20/50: 5%, ≥20/40: 92%

      <context>
      {context}
      </context>
      
      Please return your answer with clear headings and lists.`;

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