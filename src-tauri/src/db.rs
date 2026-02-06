use sea_orm::{Database, DatabaseConnection, DbErr, ConnectOptions, ConnectionTrait};
use std::env;
use std::time::Duration;

/// Initialize database connection with proper configuration
pub async fn init_db() -> Result<DatabaseConnection, DbErr> {
    // Load environment variables from .env file
    dotenv::dotenv().ok();

    // Get database URL from environment
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set in environment variables");

    // Configure connection options
    let mut opt = ConnectOptions::new(database_url);
    opt.max_connections(5)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(8))
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(8))
        .max_lifetime(Duration::from_secs(300))
        .sqlx_logging(false) // Disable SQLx logging to reduce noise
        .map_sqlx_postgres_opts(|pg_opts| {
            // Disable prepared statement caching to prevent "statement already exists" errors
            // when using connection poolers like PgBouncer/Supavisor in transaction mode
            pg_opts.statement_cache_capacity(0)
        });

    // Connect to database with options
    let db = Database::connect(opt).await?;

    println!("[DB] Connected to PostgreSQL database with connection pool (prepared statements disabled)");

    Ok(db)
}

/// Test database connection
pub async fn test_connection(db: &DatabaseConnection) -> Result<(), DbErr> {
    use sea_orm::Statement;
    
    // Simple query to test connection
    let _result = db
        .execute(Statement::from_string(
            db.get_database_backend(),
            "SELECT version()".to_string(),
        ))
        .await?;

    println!("[DB] Database connection test successful");
    Ok(())
}