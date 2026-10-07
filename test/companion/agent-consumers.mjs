import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const api = process.env.COMPANION_API_CHECKOUT;
if (!api)
  throw Error("Set COMPANION_API_CHECKOUT to a disposable API checkout");
const frontend = fileURLToPath(new URL("../..", import.meta.url));
const generated = [];
const schemas = JSON.stringify(
  resolve(frontend, "src/storefront/agent-commerce.ts"),
);
const parser = JSON.stringify(
  resolve(frontend, "src/storefront/agent-stream.ts"),
);
/** Reuse the API's existing isolated persistence fixtures; never modify tracked API files. */
try {
  for (const [fixture, assertions] of [
    [
      "agentCart",
      `
import {cartEventSchema as consumerCart, agentCartSchema as consumerState, appliedSchema as consumerReceipt} from ${schemas};
test('frontend accepts actual selected/applied events and owned HTTP receipts without replay', async () => {
 const publish=vi.fn();const tools=await build(()=>true,publish);
 await tools!.execute(options);
 await tools!.execute({name:'selection_set',arguments:{productId:1,filamentId,quantity:2}});
 await tools!.execute(add);
 for(const [result] of publish.mock.calls) consumerCart.parse({runId:input.runId,uiRevision:input.uiRevision,result});
 const response=await routes.request('/cart/'+cartId+'/agent-state',{},env);
 expect(consumerState.parse(await response.json()).items[0]?.quantity).toBe(2);
 const receipt=await routes.request('/cart/'+cartId+'/agent-actions/'+sessionId+'/'+input.runId,{},env);
 expect(consumerReceipt.parse(await receipt.json()).appliedRevision).toBe(1);
 await expect(tools!.execute(add)).rejects.toMatchObject({status:409});
 const unchanged=await routes.request('/cart/'+cartId+'/agent-state',{},env);
 expect(consumerState.parse(await unchanged.json()).items[0]?.quantity).toBe(2);
});`,
    ],
    [
      "agentCheckout",
      `
import {commerceEventSchema as consumerCommerce} from ${schemas};
import {readAgentStream as consumerStream} from ${parser};
test('frontend consumes actual review/order/recovery output while payment remains absent', async () => {
 const published=vi.fn();const run=input();const tools=build(run,'owner',published);
 await tools.execute(prepare);
 await tools.execute({name:'customer_orders',arguments:{}});
 await tools.execute({name:'checkout_attempt_status',arguments:{requestKey:crypto.randomUUID()}});
 const correlation={runId:run.runId,uiRevision:run.uiRevision};
 for(const [result] of published.mock.calls) consumerCommerce.parse({...correlation,result});
 const review=published.mock.calls[0][0].review;
 const direct=await request(review.quoteId);expect((await direct.json()).totalCents).toBe(review.totalCents);
 const {compose}=await import('../../src/shopping/composition');
 const batch={...compose(JSON.stringify(final),[]),...correlation};
 const visit='55555555-5555-4555-8555-555555555555';
 const frames=[{type:'RUN_STARTED',threadId:visit,runId:run.runId,metadata:{uiRevision:run.uiRevision}},{type:'CUSTOM',name:'lulu.progress.v1',value:{...correlation,stage:'admission',invocation:0}},...published.mock.calls.map(([result])=>({type:'CUSTOM',name:'lulu.commerce.v1',value:{...correlation,result}})),{type:'CUSTOM',name:'lulu.a2ui.v1',value:batch},{type:'RUN_FINISHED',threadId:visit,runId:run.runId,result:{uiRevision:run.uiRevision,status:'completed'}}];
 const response=new Response(frames.map(value=>'data: '+JSON.stringify(value)+'\\n\\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
 const result=await consumerStream(response,{sessionId:visit,...correlation},new AbortController().signal,vi.fn());
 expect(result.effects).toHaveLength(3);
 expect(await db.select().from(schema.checkoutAttempts)).toEqual([]);
});`,
    ],
  ]) {
    const file = resolve(
      api,
      `test/persistence/lulu-${fixture}-consumer-${process.pid}.spec.ts`,
    );
    generated.push(file);
    const original = await readFile(
      resolve(api, `test/persistence/${fixture}.spec.ts`),
      "utf8",
    );
    await writeFile(file, `${original}\n${assertions}`, { flag: "wx" });
  }
  await run([
    "exec",
    "drizzle-kit",
    "generate",
    "--config",
    "test/quotes.drizzle.config.ts",
  ]);
  await run([
    "exec",
    "vitest",
    "run",
    "--config",
    "test/quotes.vitest.config.ts",
    ...generated,
  ]);
} finally {
  await Promise.all(generated.map((file) => rm(file, { force: true })));
}
function run(args) {
  return new Promise((done, reject) => {
    const child = spawn("corepack", ["pnpm", ...args], {
      cwd: api,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(Error(`Companion consumer checks failed (${code})`)),
    );
  });
}
