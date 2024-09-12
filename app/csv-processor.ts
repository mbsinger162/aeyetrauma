import { OpenAI } from '@langchain/openai';
import { ConversationChain } from 'langchain/chains';

export async function processQuery(query: string): Promise<string> {
  const model = new OpenAI({ temperature: 0.9 });
  const chain = new ConversationChain({ llm: model });
  
  const response = await chain.call({ input: query });
  return response.response;
}
