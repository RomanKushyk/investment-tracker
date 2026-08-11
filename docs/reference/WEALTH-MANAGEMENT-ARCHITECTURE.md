Wealth Management Tracker: Business Logic & Architecture SpecificationThis document outlines the core business logic, formulas, and resolved architectural edge-cases for a Wealth Management/Investment Tracking application. It is optimized for migrating from a spreadsheet (Google Sheets) environment to a modern web application stack (e.g., React/Vue frontend, Node.js/Python backend, SQL/NoSQL database).1. Core Paradigm: Single Source of Truth (SSOT)Challenge Encountered: Desynchronization of the balance sheet. In earlier iterations, "Free Cash" was either entered manually or calculated residually based on asset values. This led to "leaks" (discrepancies between total deposits and actual capital).Resolution: The Transactions ledger must be the only mutator of state. All balances, cash holdings, and portfolio metrics must be treated strictly as Derived State, calculated dynamically from the ledger.1.1 Universal Formula: General Ledger (Free Cash)Free cash is the net sum of all money flowing in and out of the system.FreeCash =
SUM(Transactions.Amount WHERE Type == "Deposit")
- SUM(Transactions.Amount WHERE Type == "Withdrawal")
- SUM(Transactions.Amount WHERE Type == "Buy" AND Source == "Own Funds")
+ SUM(Transactions.Amount WHERE Type == "Interest Payout")
+ SUM(Transactions.Amount WHERE Type == "Dividend Payout")
- SUM(Transactions.Amount WHERE Type == "Tax")
- SUM(Transactions.Amount WHERE Type == "Reinvestment")
+ SUM(Transactions.Amount WHERE Type == "Sell")
+ SUM(Transactions.Amount WHERE Type == "Bond Redemption")
2. Portfolio Metrics & The "Illusion of Loss"Challenge Encountered: "Price Return vs Total Return" desynchronization. Instruments like government bonds (OVDP) or dividend-paying real estate funds (REITs) naturally drop in market price immediately after a coupon/dividend payout. Calculating profit purely as (Current Value - Invested) created an illusion of severe losses, ignoring the physical cash generated.Additionally: Ignoring taxes paid on dividends inflated the Gross ROI (Tax Illusion).Resolution: Decompose metrics into Capital Gain (unrealized price changes) and Total Return (realized cash + unrealized value, strictly Net of taxes).2.1 Universal Formulas: Portfolio Yield// 1. Capital Injections
   InvestedOwn = SUM(Transactions.Amount WHERE Asset == CurrentAsset AND Type == "Buy" AND Source == "Own Funds")
   Reinvested = SUM(Transactions.Amount WHERE Asset == CurrentAsset AND Type == "Reinvestment")

// 2. Realized Cash Flows
PayoutsGross = SUM(Transactions.Amount WHERE Asset == CurrentAsset AND Type IN ["Interest Payout", "Dividend Payout"])
TaxesPaid = SUM(Transactions.Amount WHERE Asset == CurrentAsset AND Type == "Tax")
PayoutsNet = PayoutsGross - TaxesPaid
SoldAmount = SUM(Transactions.Amount WHERE Asset == CurrentAsset AND Type IN ["Sell", "Bond Redemption"])

// 3. Performance Metrics
CapitalGain = CurrentValue - InvestedOwn - Reinvested
TotalNetProfit = CurrentValue + PayoutsNet + SoldAmount - InvestedOwn - Reinvested

// 4. Relative Returns (Yield)
CashYieldPercentage = PayoutsNet / (InvestedOwn + Reinvested)
CapitalGainPercentage = CapitalGain / (InvestedOwn + Reinvested)
TotalReturnPercentage = TotalNetProfit / InvestedOwn
3. The Rebalancing Engine (Moving Target Problem)Challenge Encountered: Standard rebalancing logic Required = (TargetShare * TotalPortfolioValue) - CurrentAssetValue is algebraically flawed. Injecting new cash into a specific asset simultaneously increases the TotalPortfolioValue. This resulted in an infinite loop where the user added funds but never mathematically reached the target percentage.Resolution: Implemented an algebraic equation that accounts for the injection increasing the denominator (total portfolio size).3.1 Universal Formula: One-Transaction Rebalance Trancheif (CurrentAsset.TargetShare <= CurrentAsset.CurrentShare) {
   RequiredTranche = 0
   } else {
   RequiredTranche =
   ((CurrentAsset.TargetShare * TotalPortfolioValue) - CurrentAsset.CurrentValue)
   /
   (1 - CurrentAsset.TargetShare)
   }
4. Time-Series Querying (Latest Asset Prices)Challenge Encountered: Array dimension conflicts and type mismatch errors. In the spreadsheet environment, attempting to fetch the latest price using virtual array multiplication ((Asset == Target) * (Date == MaxDate)) inside a lookup function caused critical parsing errors. Standard reverse lookups failed if the historical quotes database was not perfectly sorted by date.Resolution: The backend architecture must rely on strict Database querying (SQL/ORM) rather than array manipulation to fetch the latest snapshot.4.1 Universal Logic: Fetching Current Price-- Backend SQL equivalent for fetching the latest price
   SELECT price
   FROM Quotes
   WHERE asset_id = :current_asset_id
   ORDER BY snapshot_date DESC
   LIMIT 1;
   Implementation Note for Web App: Always handle null values gracefully (e.g., return 0 or previous_close) to prevent UI crashes if a quote is missing for a specific date.5. Global Dashboard & Balance Sheet MatrixChallenge Encountered: Denominator corruption in Global ROI. Initially, reinvested dividends were added to the "Total Invested" base. This mathematically diluted the Global ROI, as system-generated capital was being treated as user-deposited capital.Resolution: Strict Balance Sheet hierarchy. Global ROI must be calculated exclusively against external user deposits.5.1 Universal Formulas: Dashboard Aggregation// 1. External Capital (Denominator)
   NetDeposits = SUM(Transactions WHERE Type == "Deposit") - SUM(Transactions WHERE Type == "Withdrawal")

// 2. Total Wealth
TotalCapital = TotalPortfolioValue + FreeCash

// 3. Global Performance
NetFinancialResult = TotalCapital - NetDeposits
GlobalROI = NetFinancialResult / NetDeposits
6. Advanced Analytics6.1 Annualized Return (XIRR / CAGR)To properly compare portfolio assets against fixed-rate bank deposits, time-weighted returns are required.Web App Implementation: Use a financial mathematics library (e.g., financial.js or a Newton-Raphson method algorithm) to calculate XIRR based on transaction dates.CashFlows = []
   Dates = []

// Outflows (Negative)
CashFlows.push(-Transactions.BuyAmount)

// Inflows (Positive)
CashFlows.push(+Transactions.PayoutsNet)
CashFlows.push(+Transactions.SellAmount)

// Terminal Value (Positive, Current Date)
CashFlows.push(+CurrentAsset.Value)

AnnualizedReturn = CalculateXIRR(CashFlows, Dates)
6.2 Seasonality (Market Timing)To identify dividend gaps and optimal entry points (e.g., buying immediately after a payout when the price drops).Logic: Group historical price changes by the day of the month.// Heatmap generation logic
For day in 1..31:
DailyReturns = QuotesTable
.filter(Asset == TargetAsset AND ExtractDay(Date) == day)
.map(ReturnPercentage)

    AverageReturn[day] = Average(DailyReturns)
