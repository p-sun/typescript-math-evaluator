/* -------------------------------------------------------------------------- */
/*                                   Parser                                   */
/* -------------------------------------------------------------------------- */

class Parser<A> {
    protected constructor(
        public readonly run: (location: Location) => ParserResult<A>
    ) { }

    runString(s: string): ParserResult<A> {
        return this.run(new Location(s, 0))
    }

    /* ------------------------------- Primitives ------------------------------- */

    static string(s: string): Parser<string> {
        return new Parser((location) => {
            const substring = location.substring()
            if (substring.startsWith(s)) {
                return ParserResult.success(new ParserSuccess(s, location.advanceBy(s.length)))
            } else {
                return ParserResult.failure(ParserFailure.create(`string: Expected '${s}' but got '${substring}'`, location.nextIndex))
            }
        })
    }

    /* ------------------------------- Combinators ------------------------------ */

    // and: Parser<A> -> Parser<B> -> Parser<[A, B]>    (Also Mononoid append)
    and<B>(pb: Parser<B>): Parser<[A, B]> {
        return new Parser((location) =>
            this.run(location)
                .bindSuccess((a) =>
                    pb
                        .run(a.location)
                        .mapSuccess((b) => a.append(b)))
                .mapFailure((failure) =>
                    failure.prependingError({
                        message: 'and: Expected both parsers to succeed',
                        nextIndex: location.nextIndex
                    }))
        )
    }

    // or: Parser<A> -> Parser<B> -> Parser<Either<A, B>>
    or<B>(pb: Parser<B>): Parser<Either<A, B>> {
        return new Parser((location) =>
            this.run(location)
                .mapValue(Either.left<A, B>)
                .bindFailure((failure1) =>
                    pb.run(location)
                        .mapValue(Either.right<A, B>)
                        .mapFailure((failure2) =>
                            failure1
                                .prependingError({ message: 'or: Expected either parser to succeed', nextIndex: location.nextIndex })
                                .appendingErrorsFrom(failure2))
                ))
    }

    /* ------------------------- Error Message Handling ------------------------- */

    label(message: string): Parser<A> {
        return this.mapFailure((failure) => failure.label(message))
    }

    scope(message: string): Parser<A> {
        return new Parser((location) =>
            this.run(location)
                .mapFailure((failure) =>
                    failure.prependingError({ message, nextIndex: location.nextIndex })
                ))
    }

    /* ------------------------------- Functor -------------------------------- */

    mapResult<B>(f: (a: ParserResult<A>) => ParserResult<B>): Parser<B> {
        return new Parser((location) => f(this.run(location)))
    }

    mapSuccess<B>(f: (a: ParserSuccess<A>) => ParserSuccess<B>): Parser<B> {
        return this.mapResult((result) => result.mapSuccess((success) => f(success)))
    }

    mapFailure(f: (a: ParserFailure) => ParserFailure): Parser<A> {
        return this.mapResult((result) => result.mapFailure((failure) => f(failure)))
    }

    /* --------------------------------- Attempt -------------------------------- */
    attempt(): AttemptParser<A> {
        return new AttemptParser(this)
    }
}

class AttemptParser<A> extends Parser<A> {
    constructor(parser: Parser<A>) {
        super((location) => {
            const result = parser.run(location)
            return result.match({
                success: (success) => ParserResult.success(success),
                failure: (failure) => ParserResult.failure(failure)
            })
        })
    }
}

/* -------------------------------------------------------------------------- */
/*                                Parser Input                                */
/* -------------------------------------------------------------------------- */

class Location {
    constructor(
        private readonly targetString: string,
        readonly nextIndex: number
    ) { }

    advanceBy(count: number): Location {
        return new Location(this.targetString, this.nextIndex + count)
    }

    substring(): string {
        return this.targetString.slice(this.nextIndex)
    }
}

/* -------------------------------------------------------------------------- */
/*                                Parser Output                               */
/* -------------------------------------------------------------------------- */

class ParserResult<A> {
    private constructor(private readonly data:
        | { isSuccessful: true, success: ParserSuccess<A> }
        | { isSuccessful: false, failure: ParserFailure }) { }

    // Pure
    static success<T>(success: ParserSuccess<T>): ParserResult<T> {
        return new ParserResult({ isSuccessful: true, success })
    }

    static failure<T>(failure: ParserFailure): ParserResult<T> {
        return new ParserResult({ isSuccessful: false, failure })
    }

    // All ADTs have a match method
    match<B>(matchers: { success: (a: ParserSuccess<A>) => B, failure: (failure: ParserFailure) => B }): B {
        if (this.data.isSuccessful) {
            return matchers.success(this.data.success)
        } else {
            return matchers.failure(this.data.failure)
        }
    }

    // Functor
    // map: (A -> B) -> F A -> F B
    mapValue<B>(f: (a: A) => B): ParserResult<B> {
        return this.mapSuccess((success) => new ParserSuccess(f(success.value), success.location))
    }

    mapSuccess<B>(f: (a: ParserSuccess<A>) => ParserSuccess<B>): ParserResult<B> {
        if (this.data.isSuccessful) {
            return ParserResult.success(f(this.data.success))
        } else {
            return ParserResult.failure(this.data.failure)
        }
    }

    mapFailure(f: (a: ParserFailure) => ParserFailure): ParserResult<A> {
        if (this.data.isSuccessful) {
            return this
        } else {
            return ParserResult.failure(f(this.data.failure))
        }
    }

    // Monad
    // bind: (A -> F B) -> F A -> F B
    bindSuccess<B>(f: (a: ParserSuccess<A>) => ParserResult<B>): ParserResult<B> {
        if (this.data.isSuccessful) {
            return f(this.data.success)
        } else {
            return ParserResult.failure(this.data.failure)
        }
    }

    bindFailure(f: (a: ParserFailure) => ParserResult<A>): ParserResult<A> {
        if (this.data.isSuccessful) {
            return this
        } else {
            return f(this.data.failure)
        }
    }
}

class ParserSuccess<A> {
    constructor(
        public readonly value: A,
        public readonly location: Location 
    ) { }

    // Monoid append : F A -> F B -> F [A, B]
    append<B>(sb: ParserSuccess<B>): ParserSuccess<[A, B]> {
        return new ParserSuccess([this.value, sb.value], sb.location)
    }
}

class ParserFailure {
    constructor(
        private readonly errors: ParserError[],
    ) { }

    static create(message: string, nextIndex: number): ParserFailure {
        return new ParserFailure([{ message, nextIndex }])
    }

    label(message: string): ParserFailure {
        const error = this.errors.at(-1);
        return new ParserFailure(
            error ? [{ message, nextIndex: error.nextIndex }] : [],
        )
    }

    prependingError(error: ParserError): ParserFailure {
        return new ParserFailure([error, ...this.errors])
    }

    appendingError(error: ParserError): ParserFailure {
        return new ParserFailure([...this.errors, error])
    }

    appendingErrorsFrom(failure: ParserFailure): ParserFailure {
        return new ParserFailure([...this.errors, ...failure.errors])
    }
}

type ParserError = { message: string, nextIndex: number }

/* -------------------------------------------------------------------------- */
/*                                   Either                                   */
/* -------------------------------------------------------------------------- */

class Either<L, R> {
    private constructor(
        private readonly data:
            | { tag: 'left'; value: L }
            | { tag: 'right'; value: R }
    ) { }

    static left<L, R>(l: L): Either<L, R> {
        return new Either<L, R>({ tag: 'left', value: l });
    }

    static right<L, R>(r: R): Either<L, R> {
        return new Either<L, R>({ tag: 'right', value: r });
    }
}

/* -------------------------------------------------------------------------- */
/*                                  Test Utils                                */
/* -------------------------------------------------------------------------- */

type TestOptions<A> = {
    testName: string,
    parser: Parser<A>,
    targetString: string
}

function assertSuccess<A>(
    options: { successValue: A, nextIndex: number } & TestOptions<A>
) {
    const { testName, parser, targetString, successValue, nextIndex } = options
    const parserSuccess = ParserResult.success(new ParserSuccess(successValue, new Location(targetString, nextIndex)))
    assertParserResultsAreEqual(testName, targetString, parser.runString(targetString), parserSuccess)
}

function assertFailure<A>(
    options: { errors: ParserError[] } & TestOptions<A>
) {
    const { testName, parser, targetString, errors } = options
    assertParserResultsAreEqual(testName, targetString, parser.runString(targetString), ParserResult.failure(new ParserFailure(errors)))
}

function assertParserResultsAreEqual<A>(testname: string, targetString: string, actual: ParserResult<A>, expected: ParserResult<A>) {
    let msg = `Actual: ` + JSON.stringify(actual, null, 2)
    if (isEqualForTests(actual, expected)) {
        console.log('\x1b[32m%s\x1b[0m', `${testname} .runString('${targetString}') PASSED\n`, msg)
    } else {
        msg += '\nExpected: ' + JSON.stringify(expected, null, 2)
        console.log('\x1b[31m%s\x1b[0m', `${testname} .runString('${targetString}') FAILED\n`, msg)
    }
}

/// Validate if two ParserResults are equal, ignoring the error messages.
function isEqualForTests<A>(
    result1: ParserResult<A>,
    result2: ParserResult<A>,
): boolean {
    return result1.match({
        success: (success1) =>
            result2.match({
                success: (success2) => JSON.stringify(success1) === JSON.stringify(success2),
                failure: () => false,
            }),
        failure: (failure1) =>
            result2.match({
                success: () => false,
                failure: (failure2) => {
                    const errors1 = failure1["errors"]
                    const errors2 = failure2["errors"]
                    return errors1.length === errors2.length &&
                        errors1.every((error, i) => errors2[i]["nextIndex"] === error["nextIndex"])
                },
            }),
    })
}

/* -------------------------------------------------------------------------- */
/*                                  Run Tests                                 */
/* -------------------------------------------------------------------------b- */

export default function run() {
    const parserAB = Parser.string("ab")

    assertSuccess({
        testName: `Test Parser.str success: string("ab")`,
        parser: parserAB,
        targetString: "abc",
        successValue: "ab",
        nextIndex: 2
    })

    assertFailure({
        testName: `Test Parser.str failure: string("ab")`,
        parser: parserAB,
        targetString: "ad",
        errors: [{ message: "", nextIndex: 0 }]
    })

    const parserABandCD = Parser.string("ab").and(Parser.string("cd"))

    assertSuccess({
        testName: "Test Parser.and success: ('ab' && 'cd')",
        parser: parserABandCD,
        targetString: "abcd",
        successValue: ["ab", "cd"],
        nextIndex: 4
    })

    assertFailure({
        testName: "Test Parser.and failure: ('ab' && 'cd')",
        parser: parserABandCD,
        targetString: "abce",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 2 }]
    })

    assertFailure({
        testName: "Test Parser.and failure: ('ab' && 'cd')",
        parser: parserABandCD,
        targetString: "WW",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 }]
    })

    const parserABandCD_and_EFandGH = Parser.string("ab").and(Parser.string("cd"))
        .and(Parser.string("ef").and(Parser.string("gh")))

    assertSuccess({
        testName: "Test nested Parser.and: ('ab' && 'cd') && ('ef' && 'gh')",
        parser: parserABandCD_and_EFandGH,
        targetString: "abcdefgh",
        successValue: [["ab", "cd"], ["ef", "gh"]],
        nextIndex: 8
    })

    assertFailure({
        testName: "Test nested Parser.and failure: ('aa' && 'bb') && 'cc'",
        parser: Parser.string("aa").and(Parser.string("bb")).and(Parser.string("cc")),
        targetString: "aabbYY",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 4 }]
    })

    assertFailure({
        testName: "Test nested Parser.and failure: ('aa' && 'bb') && 'cc'",
        parser: Parser.string("aa").and(Parser.string("bb")).and(Parser.string("cc")),
        targetString: "aaYYcc",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 2 }]
    })

    assertFailure({
        testName: "Test nested Parser.and failure: 'aa' && ('bb' && 'cc')",
        parser: Parser.string("aa").and(Parser.string("bb").and(Parser.string("cc"))),
        targetString: "aaWWcc",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 2 },
            { message: "", nextIndex: 2 }]
    })

    assertFailure({
        testName: "Test nested Parser.and failure: 'aa' && ('bb' && 'cc')",
        parser: Parser.string("aa").and(Parser.string("bb").and(Parser.string("cc"))),
        targetString: "aabbZZ",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 2 },
            { message: "", nextIndex: 4 }]
    })

    const parserGorH = Parser.string("GG").or(Parser.string("HH"))

    assertSuccess({
        testName: `Test Parser.or success right: GG || HH`,
        parser: parserGorH,
        targetString: "HH",
        successValue: Either.right("HH"),
        nextIndex: 2
    })

    assertSuccess({
        testName: `Test Parser.or success right: GG || HH`,
        parser: parserGorH,
        targetString: "GG",
        successValue: Either.left("GG"),
        nextIndex: 2
    })

    assertFailure({
        testName: "Test Parser.or failure",
        parser: parserGorH,
        targetString: "MM",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 }]
    })

    assertFailure({
        testName: "Test nested ors: ab || (gh || ij)",
        parser: Parser.string("ab")
            .or(Parser.string("gh").or(Parser.string("ij"))),
        targetString: "MM",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 }]
    })

    const parserNestedAndsOrs =
        Parser.string("ab")
            .and(Parser.string("cd")
                .or(Parser.string("ef")))
            .or(Parser.string("gh")
                .or(Parser.string("ij")))

    assertSuccess({
        testName: "Test nested and & or: (ab && (cd || ef)) || (gh || ij)",
        parser: parserNestedAndsOrs,
        targetString: "ij",
        successValue: Either.right(Either.right("ij")),
        nextIndex: 2
    })

    assertFailure({
        testName: "Test nested and & or: (ab && (cd || ef)) || (gh || ij)",
        parser: parserNestedAndsOrs,
        targetString: "abij",
        errors: [
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 2 },
            { message: "", nextIndex: 2 },
            { message: "", nextIndex: 2 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 },
            { message: "", nextIndex: 0 }]
    })

    assertFailure({
        testName: `Test label: AA && (TT || RR)`,
        parser: Parser.string("AA")
            .and(Parser.string("TT").or(Parser.string("RR"))
            .label("label: TT or RR failed")
        ),
        targetString: "AAMM",
        errors: [
            { message: "and: Expected both parsers to succeed", nextIndex: 0 },
            { message: "label: TT or RR failed", nextIndex: 2 }]        
    })

    assertFailure({
        testName: `Test label: AA && (TT || RR)`,
        parser: Parser.string("AA")
            .and(Parser.string("TT").or(Parser.string("RR")))
            .scope("label: AND parser failed"),
        targetString: "AAMM",
        errors: [
            { message: "label: AND parser failed", nextIndex: 0 },
            { message: "and: Expected both parsers to succeed", nextIndex: 0 },
            { message: "or: Expected either parser to succeed", nextIndex: 2 },
            { message: "string: Expected 'TT' but got 'MM'", nextIndex: 2 },
            { message: "string: Expected 'RR' but got 'MM'", nextIndex: 2 }]
    })

    assertSuccess({
        testName: "Test attempt: AA && BB",
        parser: Parser.string("AA")
            .and(Parser.string("BB").attempt())
            .and(Parser.string("CC")),
        targetString: "AACC",
        successValue: ["AA", ["BB", "CC"]],
        nextIndex: 4
    })
}
