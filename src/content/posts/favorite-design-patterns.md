---
title: "My favorite design patterns"
description: "Summary of a lecture i gave on the software design patterns: Factory, Singleton, Strategy, Controller–Service–Repository, Dependency Injection."
date: 2026-06-28
tags: ["design-patterns", "software-engineering", "dependency-injection", "typescript", "python", "backend"]
---



Factory, Singleton, Adapter, and Strategy — four patterns I actually use, not just know the names of — and then the two structural ideas that those patterns feed into: the **Controller–Service–Repository** split and **Dependency Injection**. 

One thing before we start. A pattern is two things: a well-tested solution to a recurring problem, and a *name*. The name is underrated. When someone says "CatFactory," you know what that class does before reading a line of it. When you say "let's use a strategy here," the whole team immediately knows the shape of the solution. That shared vocabulary is worth the price of admission on its own — even if you're already writing these patterns without knowing it. Especially then, actually.

> A good companion to this post: [Refactoring.Guru](https://refactoring.guru/design-patterns) has clear write-ups of virtually every pattern. I keep going back to it.

All the code here is pseudocode — somewhere between TypeScript and Python. Don't get stuck on the syntax; focus on the shape.

---

## Factory

The Factory pattern lets you create a method (or a class) whose job is to **return an object of some class**, often fully or partially pre-populated.

Say we have a `Cat`:

```python
class Cat:
    age: int
    weight: float
    mother: "Cat"
```

A Factory wraps the messy work of constructing one:

```typescript
class CatFactory {
  static create(mother: Cat, weight: number): Cat {
    const cat = new Cat();
    cat.age = 0;           // just born
    cat.mother = mother;
    cat.weight = weight;
    return cat;
  }
}
```

By convention the method is usually `static` and usually called `create`. That's the whole pattern: a class with a method that hands you back a constructed instance.

### Why bother wrapping `new`?

The interesting cases are when you **don't know up front which class you need**. Suppose the type to create depends on incoming data at runtime:

```typescript
type Breed = "chihuahua" | "pitbull";   // a string literal type

class Dog {
  breed: Breed;
}

class AnimalFactory {
  static create(breed?: Breed): Cat | Dog {
    if (breed !== undefined) {
      return new Dog(breed);
    }
    return new Cat();
  }
}
```

(Aside: I love [string literal types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#literal-types) — a restricted set of allowed string values, where anything else is a type error. Python gets the same thing via [`typing.Literal`](https://docs.python.org/3/library/typing.html#typing.Literal): `breed: Literal["chihuahua", "pitbull"]`.)

This is exactly where Factory earns its keep:

- **Libraries that adapt to their environment.** A library might need to hand you a "date generator" object, but the concrete implementation differs depending on the OS it's running on. You ask the factory; it figures out the right one and returns it.
- **External providers.** You set up access to AWS, GCS, etc. with differently-shaped config. A factory can inspect what credentials it was given ("this looks like an AWS profile") and instantiate the matching client. (Though if you're *translating* one provider's interface to another's, you probably want an **Adapter** — more on that below.)

### Factory method vs. Factory class

There's a perennial debate: is "Factory" the `create` *method*, or does it imply a dedicated `Factory` *class*? Both usages are correct. A `create` method living inside some other class is a **factory method**; a standalone `CatFactory` is a **factory class**. The class form is louder — it slaps you in the face and says "I produce instances" — but the method form is the same idea.

One anti-pattern to call out: a `create`/factory method **must return an instance**. If I see something named like a factory that returns nothing and instead, say, secretly initializes some singletons as a side effect, I will be annoyed. *Factory must grow.* It produces instances; that's the deal.

---

## Singleton

A Singleton is a class **guaranteed to be instantiated only once** for the lifetime of your runtime.

The classic use case is a database connection — you want to connect **once** and reuse that connection (or, more commonly in practice, a [connection pool](https://en.wikipedia.org/wiki/Connection_pool)) everywhere. Spinning up a fresh connection on every call wastes resources, and two competing connections invite race conditions.


```typescript
import { DatabaseConnectionInstance } from "mongodb";

class DatabaseConnection {
  // STATIC field — shared across the whole program, not per-instance
  private static instance: DatabaseConnectionInstance;

  private static connect(): DatabaseConnectionInstance {
    DatabaseConnection.instance = new DatabaseConnectionInstance({
      url: "...",
      password: "...",
    });
    return DatabaseConnection.instance;
  }

  static getConnection(): DatabaseConnectionInstance {
    if (DatabaseConnection.instance === undefined) {
      return DatabaseConnection.connect();   // first call: create it
    }
    return DatabaseConnection.instance;       // later calls: reuse it
  }
}
```

The critical detail is that `instance` is **static**. A static field belongs to the *class*, not to any one object, so it's shared by everyone. If you make it a normal instance field, every `new DatabaseConnection()` gets its own `instance`, it's always `undefined`, and you reconnect every single time — defeating the entire point. 

Usage is then dead simple — and because everything is static, you never call `new`:

```typescript
const connection = DatabaseConnection.getConnection();
connection.execute("SELECT * FROM cats");
```

---

## Adapter

This one is so self-explanatory it doesn't need code. You have code written against, say, MongoDB's query style, and now you want to talk to SQL instead. You write an **Adapter**: a translation layer that lets you keep your existing calling convention while it translates the requests into the target system's syntax underneath.

That's it. If you're writing a thing that translates the vocabulary of one API into the vocabulary of another — remapping method names, reshaping arguments, swapping types — you're writing an Adapter.

---

## Strategy

Strategy is one of my favorites, and I use it constantly. A classic place it comes up: notification systems.

The situation: `NotificationFlow` sends a message in a fixed sequence:

```typescript
class NotificationFlow {
  send() {
    this.formatMessage();
    this.deliver();
    this.logDelivery();
  }
}
```

You support three channels — email, SMS, push. Logging is identical everywhere. But **formatting** and **delivery** differ completely: email needs HTML, a subject line, and MIME headers; SMS has a 160-character hard limit and a totally different API; push goes through FCM or APNs with its own payload shape.

Before Strategy, this is one class with `if email … elif sms … elif push …` branches everywhere. The killer problem: as channels multiply, **you will eventually forget a combination**, and it breaks at runtime.

### The Strategy refactor

Step one: a **registry** mapping a key to a strategy class.

```typescript
const registry = {
  "email": EmailStrategy,   // these are CLASSES, not instances
  "sms":   SmsStrategy,
  "push":  PushStrategy,
};
```

Step two: an **abstract base** declaring the contract, and concrete implementations:

```typescript
abstract class AbstractNotificationStrategy {
  abstract formatMessage(content: NotificationContent): FormattedMessage;
  abstract deliver(message: FormattedMessage, recipient: Recipient): void;
}

class EmailStrategy extends AbstractNotificationStrategy { /* ... */ }
class SmsStrategy   extends AbstractNotificationStrategy { /* ... */ }
class PushStrategy  extends AbstractNotificationStrategy { /* ... */ }
```

Step three: pick the strategy (here, in the constructor — though it could happen anywhere):

```typescript
class NotificationFlow {
  private strategy: AbstractNotificationStrategy;

  constructor(channel: string) {
    this.strategy = this.getStrategy(channel);
  }

  private getStrategy(channel: string): AbstractNotificationStrategy {
    // look up the class in the registry, instantiate, return it
    // ...
  }

  send(content: NotificationContent, recipient: Recipient) {
    const message = this.strategy.formatMessage(content);
    this.strategy.deliver(message, recipient);
    this.logDelivery(recipient);   // shared, channel-agnostic
  }
}
```

Notice that `getStrategy` is, in essence, a **factory method** — it uses the registry to decide what to build. Patterns compose.

### A neat trick: composite keys

Email has one more dimension: *type*. Transactional emails (password resets, receipts) bypass unsubscribe lists and rate limits; marketing emails don't. Instead of nesting more conditionals, you make the registry key a **tuple**:

```python
registry = {
  ("email", "transactional"): TransactionalEmailStrategy,
  ("email", "marketing"):     MarketingEmailStrategy,
  ("sms",   "transactional"): TransactionalSmsStrategy,
  ("sms",   "marketing"):     MarketingSmsStrategy,
}
```

Now there are four strategies, and each one only implements what it actually needs. No forgotten combinations.

### The payoff the type system gives you

Because `NotificationFlow` only knows its dependency as `AbstractNotificationStrategy`, you **cannot accidentally call a method that exists on only one concrete strategy**. If you add `trackOpenRate()` to `EmailStrategy` alone, `this.strategy.trackOpenRate()` won't compile — the compiler knows the declared type is the abstract base, which has no such method. (In dynamically-typed Python it'll *run*, but your language server will still flag it.) The abstract class is the contract that guarantees every combination lines up.


---

## Interlude: Controller–Service–Repository

Before Dependency Injection, we need a way to organize a backend. This is less a Gang-of-Four pattern and more an architectural convention — a cousin of [MVC](https://en.wikipedia.org/wiki/Model%E2%80%93view%E2%80%93controller), sitting on roughly the same shelf. 

Three conceptually distinct kinds of class, with an agreement about what goes where:

- **Service** — *all your business logic.* If there's math, it goes in the service. If creating one object triggers creating another, that's the service. All your app's "know-how" lives here. That's basically the whole definition.

- **Repository** — *your access layer to anything external.* Talk to a third-party API? Wrap it in a repository (`WeatherApiRepository`). Talk to a database? That's an API too — `cats.create()` inserts a row into the `cats` table. Why wrap it? Because someday you'll swap Postgres for MongoDB, and if all DB access is behind `CatsRepository`, you replace `CatsPostgresRepository` with `CatsMongoRepository` and *the rest of the program doesn't change* — as long as the method signatures stay the same. 

- **Controller** — *the input/edge layer of your program.* For an HTTP service, the controller checks which request came in, validates the path, verifies the auth header, extracts parameters, and dispatches to the right service. Your clients always reach the app through a controller.

A nice way to internalize the controller's role: **you can have more than one set of controllers over the same services.** An HTTP controller and a CLI controller can wrap the *same* service methods — you only rewrite the edge, and all your business logic is reused as-is.

---

## Dependency Injection

Now the main event. People hype DI endlessly, and honestly it's *overhyped relative to how simple the core idea is* — but it's genuinely great and you should use it.

Let's build a paginated `GET /cats` endpoint across the three layers, then watch the problem emerge.

**Controller** — pulls params off the request, calls the service:

```typescript
class CatsController {
  getPaginated(request: HttpRequest) {
    const filter = getFilterFromHttpRequest(request);
    const { perPage, pageNumber } = getPaginationFromHttpRequest(request);
    return this.catsService.getPaginated(perPage, pageNumber, filter);
  }
}
```

**Service** — turns page math into `offset`/`limit` and shapes the response. (This is business logic, so it lives here.)

```typescript
class CatsService {
  getPaginated(perPage: number, pageNumber: number, filter: object) {
    const offset = (pageNumber - 1) * perPage;   // page 1 -> offset 0
    const limit = perPage;

    const cats = this.catsRepository.findMany(filter, offset, limit);

    return {
      data: cats,
      meta: { total: /* ... */, perPage, pageNumber },
    };
  }
}
```


**Repository** — the actual data access:

```typescript
class CatsPostgresRepository {
  findMany(filter: object, offset: number, limit: number) {
    return this.dbConnection
      .execute("SELECT * FROM cats WHERE ... OFFSET ? LIMIT ?", offset, limit);
  }
}
```

### The problem

Now you want to support MongoDB too. You copy the repository into a `CatsMongoRepository` with the same method signatures but an aggregation-pipeline body. Fine. But how does the *service* get the right repository?

The naive version hard-codes it:

```typescript
class CatsService {
  private catsRepository = new CatsPostgresRepository();  // 🔒 welded to Postgres
}
```

That's the coupling we want to kill. The fix: depend on an **abstraction**, and **pass the concrete one in from outside**.

```typescript
abstract class CatsDataRepository {
  abstract findMany(filter: object, offset: number, limit: number): Cat[];
}

class CatsService {
  private catsRepository: CatsDataRepository;

  constructor(repository: CatsDataRepository) {   // 👈 injected
    this.catsRepository = repository;
  }
}
```

**That's dependency injection.** Instead of a class hard-coding the classes it uses one level down, you *inject* them at construction time. The service no longer cares which repository it got — Postgres, Mongo, or a fake. You can hand repository development to one team and service development to another. **Full decoupling.**

The same logic applies at the controller level — inject the service:

```typescript
class CatsController {
  constructor(private catsService: CatsService) {}
}
```

And you wire the whole thing together at the entry point:

```typescript
// entry point
const controller = new CatsController(
  new CatsService(
    new CatsPostgresRepository()   // swap this one line to change everything
  )
);
```

### Two clarifications worth burning in

1. **You inject *instances*, not classes.** It's tempting to say "pass the class in," but you pass a constructed object. This matters: if instantiation can fail, you want that failure to happen *here*, at the composition root, not buried inside a dependent class.

2. **CSR ≠ DI.** Splitting into Controller/Service/Repository is one pattern; injecting dependencies through constructors is another. They pair beautifully, but they're separate ideas.


### "Why not inject *every* field, then?"

Because in DI-style code, **constructors are nearly empty** — they take dependencies and nothing else. These classes (controllers, services, repositories) are essentially **stateless modules** that expose what amount to clean functions; the only stateful thing they hold is their dependencies. You would *not* DI a real, stateful `Cat` object that carries `age` and `name` — that way lies madness. DI is for the wiring, not the domain data.


---

## DI grows up: frameworks

Dependency Injection is such a foundational idea that **entire frameworks are built around it.**

- **[NestJS](https://docs.nestjs.com/providers)** (Node/TypeScript) bakes DI into its core. You mark classes as providers, declare modules, and write `private catsService: CatsService` in a constructor — Nest resolves and supplies the instance for you, **as a singleton**, without you ever writing `new CatsService()`.
- **[Angular](https://angular.dev/guide/di)** does essentially the same thing on the frontend — the pattern is one-to-one.

The mechanism in both: you decorate classes as injectable, the framework keeps a **registry of singleton instances**, and it resolves the dependency graph for you. (Yes — Singleton, quietly doing its job inside the framework.)

### Doing it by hand with TSyringe

If you don't want a whole framework, [`tsyringe`](https://github.com/microsoft/tsyringe) (a Microsoft TypeScript DI library) gives you the essentials. You mark classes `@injectable()`:

```typescript
@injectable()
class CatsPostgresRepository extends CatsDataRepository { /* ... */ }

@injectable()
class CatsService {
  constructor(private repository: CatsDataRepository) {}
}
```

You register which concrete class satisfies which token:

```typescript
import { container } from "tsyringe";

container.register("CatsDataRepository", { useClass: CatsPostgresRepository });
// or bind a literal value:
container.register("Config", { useValue: configObject });
```

…and you resolve from the container when you need a fully-wired object:

```typescript
const catsController = container.resolve(CatsController);
// arrives with service + repository already injected, all the way down
```

The rule that falls out of this: **if an injectable depends on something, that something must also be injectable** — all the way down the graph.

The big practical win — bigger than "swap Postgres for Mongo," which let's be honest you rarely do — is **testing**. You stand up a separate registry for tests that binds the same token to a stub, and now your controller and service tests run against a fake repository that returns canned data from a fixture file. No production code changes. 

---

## The payoff: Base Repository / Service / Controller

Here's the example that, for me, makes the whole case. Suppose your API has `Cat`. For it you write a controller, a service, and a repository, each implementing the same set of handles: `getOne`, `getMany`, `createOne`, `createMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`.

Now add `Dog`. Same handles, three more classes. Add monkeys — three more. You're paying a **Cartesian product** of (entities × layers) in boilerplate. Painful.

But here's the thing: in a typical web app, **that logic is nearly identical across entities**, with only rare overrides. DI lets you write it *once* on abstract base classes and specialize with almost nothing. This is the **Base Repository / Base Service / Base Controller** approach.

The base repository is abstract **and generic**, parameterized by an *insert* type and a *read* type (rows gain `id`, `created_at`, `updated_at` once persisted):

```typescript
abstract class BaseRepository<TInsert, TRead> {
  constructor(
    private dbConnection: DbConnection,   // injected
    private tableName: string,            // injected per entity
  ) {}

  createOne(data: TInsert): TRead {
    this.dbConnection.execute(`INSERT INTO ${this.tableName} ...`, data);
    const readData = this.dbConnection.execute(
      `SELECT * FROM ${this.tableName} WHERE id = ?`, /* new id */
    );
    return readData;   // the row as stored, with id/timestamps
  }
}
```

The base service just delegates (it's a thin pass-through *until* you need logging, rate limiting, etc.):

```typescript
abstract class BaseService<TInsert, TRead> {
  constructor(private repository: BaseRepository<TInsert, TRead>) {}

  createOne(data: TInsert): TRead {
    return this.repository.createOne(data);
  }
}
```

The base controller delegates to the service:

```typescript
abstract class BaseController<TInsert, TRead> {
  constructor(private service: BaseService<TInsert, TRead>) {}

  createOne(data: TInsert): TRead {
    return this.service.createOne(data);
  }
}
```

Now — to support a whole new entity, you write only this:

```typescript
class CatRepository extends BaseRepository<CatCreateDTO, CatReadDTO> {
  constructor(dbConnection: DbConnection) {
    super(dbConnection, "cats");   // the only entity-specific bit
  }
}

class CatService extends BaseService<CatCreateDTO, CatReadDTO> {
  constructor(repository: CatRepository) {   // narrow to CatRepository
    super(repository);
  }
}

class CatController extends BaseController<CatCreateDTO, CatReadDTO> {
  constructor(service: CatService) {
    super(service);
  }
}
```

Notice there's **no `createOne` (or `getMany`, `deleteOne`, …) on any of these.** They inherit those from their base classes. DI injects the right repository (which injects the right table name) at the right moment, and the generic types keep everything aligned. You wrote the CRUD logic *once*. The [DTOs](https://en.wikipedia.org/wiki/Data_transfer_object) — `CatCreateDTO` and `CatReadDTO` (the read DTO adds `id`, `created_at`, etc.) — are the only per-entity data definitions you supply.

When an entity genuinely needs something different, you still have the escape hatch: **override** the method on that one class.

```typescript
class CatController extends BaseController<CatCreateDTO, CatReadDTO> {
  // ...
  createOne(data: CatCreateDTO): CatReadDTO {
    const result = this.service.createOne(data);
    doSomethingExtra(result);   // cat-specific behavior
    return result;
  }
}
```

So you get the best of both: write CRUD once on the base classes, specialize per entity with a few lines, override only the rare special case — and the whole thing stays injectable (and therefore testable). With 20, 30, 40 models in a real service, this is a massive simplification.

### "Couldn't we do this without DI?"

Fair challenge — and worth walking through, because it's exactly *why* DI exists. You can get most of the way with plain OOP and inheritance. `BaseRepository` takes `tableName` in its constructor; `CatRepository` calls `super("cats")`. That works.

It falls apart at the service layer. `CatService extends BaseService`, but `BaseService` constructs a `BaseRepository` — and you need it to use a `CatRepository` instead, *without* rewriting the logic. Your options without DI:

- Build a **factory** inside `BaseService` that picks the repository by a parameter. But now the service has to *know* about choosing repositories — and worse, you've inverted the dependency direction (the base layer reaching down to decide concretes). You've essentially reimplemented dependency injection by hand, more clumsily.
- Pass the concrete repository through the constructor… which *is* dependency injection. You just rediscovered it.

And even if you bodge it at the service layer, it stops being easy once you push up to the controller layer. Constructor injection — the thing DI frameworks give you for free — is what makes the whole stack compose cleanly and stay mockable. **Could you do it without DI? Yes. But why, when there's a pattern built precisely for this?**

---

## A closing aside that's *not* DDD

One correction on terminology, because I got this wrong for years. I used to think the Controller–Service–Repository split *was* Domain-Driven Design. It isn't.

- **CSR is a layered architecture pattern** focused on *technical* concerns — where code lives.
- **[Domain-Driven Design](https://en.wikipedia.org/wiki/Domain-driven_design)** centers your model and language on the *business domain* rather than technical structure. It's when you write a class called `OrderPlacedEvent` to model something that happened in the business, and when your `Order` means the same thing to the code as it does to the project manager and the sales team. It's more philosophy than mechanism — approach with caution.

The two are orthogonal. You can do CSR without DDD, and vice versa.


