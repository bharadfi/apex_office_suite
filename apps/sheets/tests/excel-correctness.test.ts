/**
 * Correctness pass: ~150 formulas evaluated by the real Univer engine (plus
 * the app's own extra functions) against results Excel documents or that are
 * standard maths. A failure here is a place where the editor disagrees with
 * Excel.
 */
import { LocaleType, LogLevel, Univer, UniverInstanceType } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import '@univerjs/sheets/facade'
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula'
import '@univerjs/sheets-formula/facade'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { installExcelFixes } from '../src/renderer/excel-fixes'
import { installExtraFunctions } from '../src/renderer/extra-functions'

type Case = [formula: string, expected: number | string | boolean]

const serial = {
  feb29: 45351,
  jan31: 45322,
}

const cases: Case[] = [
  // math
  ['=SUM(1,2,3)', 6],
  ['=ROUND(2.675,2)', 2.68],
  ['=ROUND(-1.5,0)', -2],
  ['=ROUNDUP(3.2,0)', 4],
  ['=ROUNDDOWN(-3.9,0)', -3],
  ['=MOD(-3,2)', 1],
  ['=MOD(3,-2)', -1],
  ['=INT(-1.5)', -2],
  ['=TRUNC(-8.9)', -8],
  ['=CEILING(2.5,1)', 3],
  ['=FLOOR(2.5,1)', 2],
  ['=CEILING.MATH(-2.5)', -2],
  ['=FLOOR.MATH(-2.5)', -3],
  ['=POWER(2,10)', 1024],
  ['=FACT(5)', 120],
  ['=FACTDOUBLE(7)', 105],
  ['=GCD(24,36)', 12],
  ['=LCM(4,6)', 12],
  ['=SQRT(16)', 4],
  ['=ABS(-5)', 5],
  ['=MROUND(10,3)', 9],
  ['=QUOTIENT(7,2)', 3],
  ['=SIGN(-3)', -1],
  ['=COMBIN(5,2)', 10],
  ['=PERMUT(5,2)', 20],
  ['=EVEN(3)', 4],
  ['=ODD(2)', 3],
  ['=ROMAN(499)', 'CDXCIX'],
  ['=ARABIC("MCMXCIV")', 1994],
  ['=SUMPRODUCT({1,2,3},{4,5,6})', 32],
  ['=SUMSQ(3,4)', 25],
  ['=PRODUCT(2,3,4)', 24],
  ['=LOG(100,10)', 2],
  ['=LN(1)', 0],
  ['=EXP(0)', 1],
  ['=PI()', Math.PI],
  ['=DEGREES(PI())', 180],
  ['=BASE(255,16)', 'FF'],
  ['=DECIMAL("FF",16)', 255],
  // statistics
  ['=AVERAGE(1,2,3,4)', 2.5],
  ['=MEDIAN(1,3,2,10)', 2.5],
  ['=MODE(1,2,2,3)', 2],
  ['=STDEV(1,2,3,4,5)', 1.5811388300841898],
  ['=STDEV.P(1,2,3,4,5)', 1.4142135623730951],
  ['=VAR(1,2,3,4,5)', 2.5],
  ['=VAR.P(1,2,3,4,5)', 2],
  ['=LARGE({1,5,3},2)', 3],
  ['=SMALL({1,5,3},2)', 3],
  ['=PERCENTILE({1,2,3,4},0.5)', 2.5],
  ['=PERCENTILE.EXC({1,2,3,4},0.5)', 2.5],
  ['=QUARTILE({1,2,3,4,5},1)', 2],
  ['=RANK(3,C1:C5)', 3],
  ['=RANK(3,C1:C5,1)', 3],
  ['=CORREL({1,2,3},{2,4,6})', 1],
  ['=SLOPE({2,4,6},{1,2,3})', 2],
  ['=INTERCEPT({2,4,6},{1,2,3})', 0],
  ['=FORECAST(4,{2,4,6},{1,2,3})', 8],
  ['=RSQ({1,2,3},{2,4,7})', 0.9868421052631579],
  ['=GEOMEAN(1,4)', 2],
  ['=HARMEAN(1,4)', 1.6],
  ['=AVEDEV(1,2,3)', 0.6666666666666666],
  ['=DEVSQ(1,2,3)', 2],
  ['=SKEW(1,2,6)', 1.4578629673],
  ['=KURT(1,2,3,4,9)', 2.67509831013],
  ['=TRIMMEAN({1,2,3,4,5,6,7,8,9,10},0.2)', 5.5],
  ['=NORM.S.DIST(0,TRUE)', 0.5],
  ['=NORM.DIST(1,0,1,TRUE)', 0.8413447460685429],
  ['=NORM.S.INV(0.975)', 1.959963984540054],
  ['=T.DIST.2T(2,10)', 0.07338803477074062],
  ['=CHISQ.DIST.RT(3,2)', 0.22313016014842982],
  ['=BINOM.DIST(2,5,0.5,FALSE)', 0.3125],
  ['=POISSON.DIST(2,3,FALSE)', 0.22404180765538775],
  ['=CONFIDENCE.NORM(0.05,1,100)', 0.19599639845400545],
  ['=COUNT(1,"a",3)', 2],
  ['=COUNTA(1,"a",3)', 3],
  // text
  ['=LEFT("abc",2)', 'ab'],
  ['=RIGHT("abc",2)', 'bc'],
  ['=MID("abcdef",2,3)', 'bcd'],
  ['=UPPER("abc")', 'ABC'],
  ['=LOWER("ABC")', 'abc'],
  ['=PROPER("hello wORLD")', 'Hello World'],
  ['=TRIM("  a   b ")', 'a b'],
  ['=SUBSTITUTE("aaa","a","b",2)', 'aba'],
  ['=REPLACE("abcdef",2,3,"X")', 'aXef'],
  ['=TEXT(1234.5,"#,##0.00")', '1,234.50'],
  ['=TEXT(0.256,"0.0%")', '25.6%'],
  ['=TEXT(DATE(2024,3,5),"yyyy-mm-dd")', '2024-03-05'],
  ['=TEXT(5,"000")', '005'],
  ['=FIND("c","abc")', 3],
  ['=SEARCH("B","abc")', 2],
  ['=REPT("ab",3)', 'ababab'],
  ['=LEN("héllo")', 5],
  ['=CONCAT("a","b")', 'ab'],
  ['=CONCATENATE("a","b")', 'ab'],
  ['=TEXTJOIN(",",TRUE,"a","","c")', 'a,c'],
  ['=TEXTJOIN(",",FALSE,"a","","c")', 'a,,c'],
  ['=VALUE("1,234")', 1234],
  ['=EXACT("a","A")', false],
  ['=CHAR(65)', 'A'],
  ['=CODE("A")', 65],
  ['=UNICODE("€")', 8364],
  ['=TEXTBEFORE("a-b-c","-")', 'a'],
  ['=TEXTAFTER("a-b-c","-",2)', 'c'],
  ['=NUMBERVALUE("1.234,5",",",".")', 1234.5],
  ['=FIXED(1234.567,1)', '1,234.6'],
  ['=DOLLAR(1234.5)', '$1,234.50'],
  ['=CLEAN("a"&CHAR(7)&"b")', 'ab'],
  ['=REGEXEXTRACT("abc123","[0-9]+")', '123'],
  ['=REGEXREPLACE("a1b2","[0-9]","#")', 'a#b#'],
  // dates
  ['=DATE(2024,2,29)', serial.feb29],
  ['=EDATE(DATE(2024,1,31),1)', serial.feb29],
  ['=EOMONTH(DATE(2024,1,15),0)', serial.jan31],
  ['=WEEKDAY(DATE(2024,1,1))', 2],
  ['=WEEKDAY(DATE(2024,1,1),2)', 1],
  ['=DATEDIF(DATE(2020,1,1),DATE(2024,6,15),"Y")', 4],
  ['=DATEDIF(DATE(2020,1,1),DATE(2024,6,15),"M")', 53],
  ['=NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,31))', 23],
  ['=WORKDAY(DATE(2024,1,5),1)', 45299],
  ['=YEARFRAC(DATE(2024,1,1),DATE(2024,7,1))', 0.5],
  ['=DAYS(DATE(2024,3,1),DATE(2024,2,1))', 29],
  ['=DAYS360(DATE(2024,1,31),DATE(2024,3,31))', 60],
  ['=ISOWEEKNUM(DATE(2021,1,3))', 53],
  ['=WEEKNUM(DATE(2024,1,1))', 1],
  ['=YEAR(DATE(2024,12,25))', 2024],
  ['=MONTH(DATE(2024,12,25))', 12],
  ['=DAY(DATE(2024,12,25))', 25],
  ['=TIME(12,30,0)', 0.5208333333333334],
  ['=HOUR(0.75)', 18],
  ['=DATEVALUE("2024-03-05")', 45356],
  // financial (Microsoft documentation examples)
  ['=PMT(0.08/12,10,10000)', -1037.0320893591],
  ['=FV(0.06/12,10,-200,-500,1)', 2581.4033740601362],
  ['=PV(0.08/12,240,500)', -59777.14585118784],
  ['=NPV(0.1,100,100,100)', 248.6851990984577],
  ['=IRR({-100,110})', 0.1],
  ['=SLN(30000,7500,10)', 2250],
  ['=SYD(30000,7500,10,1)', 4090.909090909091],
  ['=DB(1000000,100000,6,1,7)', 186083.33333333334],
  ['=DDB(2400,300,10,1)', 480],
  ['=RATE(48,-200,8000)', 0.007701472488246008],
  ['=NPER(0.12/12,-100,-1000,10000,1)', 59.67386567429457],
  ['=IPMT(0.1/12,1,36,8000)', -66.66666666666667],
  ['=PPMT(0.1/12,1,36,8000)', -191.47083088403394],
  ['=EFFECT(0.0525,4)', 0.05354266737],
  ['=NOMINAL(0.053543,4)', 0.0525],
  ['=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)', 0.1260941303659051],
  ['=CUMIPMT(0.09/12,360,125000,1,1,0)', -937.5],
  ['=FVSCHEDULE(1,{0.09,0.11,0.1})', 1.33089],
  ['=PDURATION(0.025,2000,2200)', 3.859866162622655],
  ['=RRI(96,10000,11000)', 0.0009933],
  // lookup / logical / info
  ['=IFERROR(1/0,"x")', 'x'],
  ['=IFNA(NA(),"y")', 'y'],
  ['=IFS(FALSE,1,TRUE,2)', 2],
  ['=SWITCH(2,1,"a",2,"b")', 'b'],
  ['=XLOOKUP(2,{1,2,3},{"a","b","c"})', 'b'],
  ['=VLOOKUP(2,{1,"a";2,"b"},2,FALSE)', 'b'],
  ['=HLOOKUP(2,{1,2;"a","b"},2,FALSE)', 'b'],
  ['=INDEX({1,2;3,4},2,1)', 3],
  ['=MATCH(3,{1,2,3},0)', 3],
  ['=MATCH(2.5,{1,2,3},1)', 2],
  ['=XMATCH(3,{1,2,3})', 3],
  ['=CHOOSE(2,"a","b")', 'b'],
  ['=AND(TRUE,FALSE)', false],
  ['=OR(TRUE,FALSE)', true],
  ['=XOR(TRUE,TRUE)', false],
  ['=NOT(FALSE)', true],
  ['=ISNUMBER(1)', true],
  ['=ISTEXT("a")', true],
  ['=ISBLANK(D1)', true],
  ['=ISERROR(1/0)', true],
  ['=ISEVEN(4)', true],
  ['=TYPE("a")', 2],
  ['=N(TRUE)', 1],
  ['=ROWS({1,2;3,4})', 2],
  ['=COLUMNS({1,2;3,4})', 2],
  ['=SUMIF(C1:C4,">2")', 7],
  ['=COUNTIF(C1:C4,">=2")', 3],
  ['=AVERAGEIF(C1:C4,">2")', 3.5],
  ['=SUMIFS(C1:C4,C1:C4,">1",C1:C4,"<4")', 5],
  ['=MAXIFS(C1:C4,C1:C4,"<3")', 2],
  ['=SUBTOTAL(9,C1:C3)', 6],
  ['=AGGREGATE(4,6,C1:C3)', 3],
  ['=SUM(FILTER({1,2,3,4},{1,2,3,4}>2))', 7],
  ['=SUM(SORT({3,1,2}))', 6],
  ['=COLUMNS(UNIQUE({1,1,2,3},TRUE))', 3],
  ['=SUM(SEQUENCE(4))', 10],
  ['=LET(x,2,x*3)', 6],
  ['=LAMBDA(x,x+1)(2)', 3],
  // engineering
  ['=BIN2DEC("1010")', 10],
  ['=DEC2HEX(255)', 'FF'],
  ['=DEC2BIN(5,8)', '00000101'],
  ['=HEX2DEC("FF")', 255],
  ['=BITAND(12,10)', 8],
  ['=BITXOR(12,10)', 6],
  ['=CONVERT(1,"mi","km")', 1.609344],
  ['=ERF(1)', 0.8427007929497149],
  ['=DELTA(2,2)', 1],
  ['=GESTEP(3,2)', 1],
  // this app's extra functions
  ['=PERCENTOF(25,100)', 0.25],
  ['=REGEXTEST("Apex","^a",1)', true],
  ['=ISO.CEILING(-4.3)', -4],
  ['=JIS("A")', 'Ａ'],
  ['=AMORDEGRC(2400,39679,39813,300,1,0.15,1)', 776],
  ['=FORECAST.ETS(13,{10,12,14,16,18,20,22,24,26,28,30,32},{1,2,3,4,5,6,7,8,9,10,11,12},0)', 34],
]

describe('Excel correctness pass', () => {
  let univer: Univer
  let api: FUniver
  const values = new Map<string, unknown>()

  beforeAll(async () => {
    univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} }, logLevel: LogLevel.ERROR })
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin)
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
      id: 'wb',
      sheetOrder: ['s1'],
      sheets: { s1: { id: 's1', name: 'S', rowCount: cases.length + 10, columnCount: 12, cellData: { 0: { 2: { v: 1 } }, 1: { 2: { v: 2 } }, 2: { 2: { v: 3 } }, 3: { 2: { v: 4 } }, 4: { 2: { v: 5 } } } } },
    })
    installExtraFunctions({ univer } as never)
    installExcelFixes({ univer } as never)
    await new Promise((resolve) => setTimeout(resolve, 50))
    api = FUniver.newAPI(univer)
    const sheet = api.getActiveWorkbook()!.getSheetBySheetId('s1')!
    cases.forEach(([formula], index) => sheet.getRange(`A${index + 1}`).setFormula(formula))
    await new Promise((resolve) => setTimeout(resolve, 4000))
    cases.forEach(([formula], index) => {
      values.set(formula, sheet.getRange(`A${index + 1}`).getCellData()?.v)
    })
  }, 60_000)

  afterAll(() => univer.dispose())

  it('GROUPBY with a real LAMBDA through the formula parser', async () => {
    const sheet = api.getActiveWorkbook()!.getSheetBySheetId('s1')!
    sheet.getRange('F1').setFormula('=GROUPBY({"b";"a";"b"},{1;2;3},LAMBDA(x,SUM(x)))')
    sheet.getRange('I1').setFormula('=PIVOTBY({"x";"x";"y"},{"p";"q";"p"},{1;2;4},LAMBDA(x,SUM(x)))')
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const at = (a: string) => sheet.getRange(a).getCellData()?.v
    expect([at('F1'), at('G1'), at('F2'), at('G2'), at('F3'), at('G3')]).toEqual(['a', 2, 'b', 4, 'Total', 6])
    expect([at('J1'), at('K1'), at('L1')]).toEqual(['p', 'q', 'Total'])
  }, 20_000)

  it.each(cases)('%s', (formula, expected) => {
    const actual = values.get(formula)
    if (typeof expected === 'boolean') {
      expect(Number(actual)).toBe(Number(expected))
    } else if (typeof expected === 'number') {
      expect(typeof actual === 'number' ? actual : Number(actual)).toBeCloseTo(expected, 4)
    } else {
      expect(actual).toBe(expected)
    }
  })
})
