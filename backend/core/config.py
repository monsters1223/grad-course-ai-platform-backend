"""配置：从 .env 读取（pydantic-settings）。"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )
    openmaic_base_url: str = "https://open.maic.chat"
    openmaic_access_code: str = ""
    jwt_secret: str = "change-me-in-production-graduate-ai-platform"
    # 留空则回落 SQLite；填写 postgresql+psycopg2://... 则连接 PostgreSQL
    database_url: str = ""
    sqlite_path: str = ""
    # 运行期数据目录（作业附件等）。容器部署设为 /app/data；Windows 原生部署设为绝对路径。
    # 留空则默认使用 backend/data。
    data_dir: str = ""
    ai_backend: str = "mock"


settings = Settings()
