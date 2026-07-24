-- CreateTable
CREATE TABLE "my_list_items" (
    "user_id" BIGINT NOT NULL,
    "title_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "my_list_items_pkey" PRIMARY KEY ("user_id","title_id")
);

-- AddForeignKey
ALTER TABLE "my_list_items" ADD CONSTRAINT "my_list_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "my_list_items" ADD CONSTRAINT "my_list_items_title_id_fkey" FOREIGN KEY ("title_id") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
