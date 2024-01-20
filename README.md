# TS State Graph

ts-state-graph organises your application state as a graph, but stores it as a normalised pool of entities. 
This makes it is easier to automatically replicate state to your backend and between clients, 
without needing to treat it like a single document. 

You'll get a two way data flow that looks like

client A: `frontend mutates graph -> mutates pool -> mutates server`

client B: `server applies mutation -> updates pool -> updates graph` 


Now you can build multiplayer, client first, web apps while you enjoy a relatively familiar looking API on your server, and reactive state management on your client.  

This is the approach described by Linear for their client side state management when discussing their [sync engine](https://www.youtube.com/watch?v=WxK11RsLqp4&t=2175s).
Except they use classes and decorators, and we use runtime types and type inference. 
If you already use zod in your API (i.e. trpc or ts-rest) this may be a good fit for you ;)

Let's have a look. Or alternatively checkout the [playground](https://codesandbox.io/p/sandbox/ts-state-graph-example-p7msm8).

```typescript
//describe your entities
//(if your api is already defined with zod you could reuse them here)
export const chatRoomModel = model({
  name: 'ChatRoom',
  shape: {
    id: z.string(),
    ownerId: z.string(),
  },
});

export const userModel = model({
  name: 'User',
  shape: {
    id: z.string(),
    name: z.string(),
    roomId: z.string(),
  },
});

export const messageModel = model({
  name: 'Message',
  shape: {
    id: z.string(),
    text: z.string(),
    authorId: z.string(),
    recipientId: z.string(),
    order: z.number(),
    roomId: z.string(),
  },
});

//describe relationships between your entities
const chatRoomOwnerRel = oneToOne(
  source(chatRoomModel, 'ownerId').auto(),
  target(userModel),
);

const userRoomRel = manyToOne(
  source(userModel, 'roomId').auto(),
  target(chatRoomModel).as('users'),
);

const authorRel = manyToOne(
  source(messageModel, 'authorId').auto(),
  target(userModel).as('outbox'),
);

const recipientRel = manyToOne(
  source(messageModel, 'recipientId').auto(),
  target(userModel).as('inbox'),
);

const messageRoomRel = manyToOne(
  source(messageModel, 'roomId').auto(),
  target(chatRoomModel).as('messages'),
);

//construct views by attaching relations to your entities
const messageView = view(messageModel).outgoing([
  authorRel,
  recipientRel,
  messageRoomRel,
]);

type MessageView = InferView<typeof messageView>;
/*
inferred as 
{
    id: string;
    roomId: string;
    text: string;
    authorId: string;
    recipientId: string;
    order: number;
    author: {
        id: string;
        name: string;
        roomId: string;
        
        //in reality this is a generic function, it doesn't actually 
        //know the return type untill you pass in the view. 
        //this is how we get around type inference problems 
        //with circular types
        //so the signature here is simplified
        as(view: typeof userView): UserView
    };
    recipient: {...};
    room: {...};
}
*/

const userView = view(userModel)
  .outgoing([userRoomRel])
  .incoming([authorRel, recipientRel]);
type UserView = InferView<typeof userView>;

/*
type UserView = {
    id: string;
    name: string;
    roomId: string;
    room: {
        id: string;
        ownerId: string;
        as(view: typeof chatRoomView): ChatRoomView
    };
    readonly inbox: {...}[] & { as(view: typeof messageView): MessageView[] };
    readonly outbox: {...}[] & { as(view: typeof messageView): MessageView[] };
 */
const chatRoomView = view(chatRoomModel)
  .outgoing([chatRoomOwnerRel])
  .incoming([messageRoomRel, userRoomRel])
type ChatRoomView = InferView<typeof chatRoomView>;

/*
type ChatRoomView = {
    id: string;
    ownerId: string;
    owner: {...};
    readonly users: {...}[] & { as(view: typeof userView): UserView[]};
    readonly messages: {...}[] & { as(view: typeof roomView): MessageView[] };
}
 */

//combine all your views into a graph schema
const chatRoomGraphSchema = graphSchema(chatRoomView, [userView, messageView])
```

2. Instantiate a graph using the implementation of your choice.


```typescript
import { OneWayGraph } from 'ts-state-graph/oneWayGraph';

const chatRoomGraph = new OneWayGraph(chatRoomGraphSchema);
```

The graph implementation will keep your graph coherent, traversable and reactive.
Different implementations will use a different approach to state management and persistence/replication.

3. Use it

```ts
//if using persistence make sure your graph has loaded first then access 
//or create the root
const chatRoomState = (chatRoomGraph.getRoot() ??
  chatRoomGraph.createRoot(
    {
      id: 'mainRoom',
      ownerId: 'alice',
    },
    [
      {
        name: 'User',
        entity: {
          id: 'alice',
          name: 'alice',
          roomId: 'mainRoom',
        },
      },
    ],
  ));


//traverse through entities
root.owner.as(userView).inbox[0].as(messageView).author.name // -> type string 
```


## Graph Implementations
These inferred types are actually for a simplified graph implementation, called oneWayGraph, 
which isn't suitable for real apps. ts-state-graph can support different graph implementations, where an implementation can control how the type of a view is inferred by exporting 
their own `source` and `target` functions. 

Different implementations will have a big impact on how your frontend is written, 
so  you can't just swap them out whenever you feel. It's more so that you (or your community) can write a graph 
implementation for your favourite state management library.


The natural fit is observables (or signals or whatever you want to call them). It's probably possible to do it with immutable objects if you resolve references at the point of traversal.


## Observable Graph

ts-state-graph contains a proper graph implementation that uses legend-state,
because the built-in persistence functionality looked promising for multiplayer web apps.

This is still in development, the client side graph part works although the api is a little clunky, local persistence works, 
I'm currently working on remote persistence.

Import source and target from legendState in your graph schema file
```typescript
import { source, target } from 'ts-state-graph/legendState';

///rest of your schema
...
```

Instantiate your graph
```typescript
import { ObservableGraph, persistGraph } from 'ts-state-graph/legendState';

export const graph = new ObservableGraph(chatRoomGraphSchema);

export const persistStatus = persistGraph(graph, {
  databaseName: 'ChatRoomExample23',
  version: 1,
});

//setup persistence
persistGraph(chatRoomGraph, {
  databaseName: 'ChatRoomExample23',
  version: 1,
});
```


Use it!


```ts
const chatRoomState = (graph.getRoot() ??
  graph.createRoot(
    {
      id: 'mainRoom',
      ownerId: 'owner',
    },
    [
      {
        name: 'User',
        entity: {
          id: 'owner',
          name: 'owner',
          roomId: 'mainRoom',
        },
      },
    ],
  )) as ObservableObject<ChatRoomView>;


//the graph is traversed differently than in the oneWayGraph
chatRoomState.owner.portal(userView).name

chatRoomState.owner.portal(userView).name.onChange(() => {})  //will fire if this user's name changes, but not if the room owner is changed
chatRoomState.owner.portal(userView).onChange(() => {})  //this will fire if the room owner is changed...
```


