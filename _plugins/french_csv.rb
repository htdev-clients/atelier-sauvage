module Jekyll
  class FrenchCSV < Generator
    safe true
    priority :highest

    def generate(site)
      require 'csv'

      csv_path = File.join(site.source, '_database', 'catalog.csv')
      # Path to your images (Source of Truth)
      img_dir = File.join(site.source, 'assets', 'img', 'catalog', '2000')

      if File.exist?(csv_path)
        csv_text = File.read(csv_path, encoding: 'bom|utf-8')

        begin
          rows = CSV.parse(csv_text, 
            headers: true, 
            col_sep: ';', 
            liberal_parsing: true
          ).map do |row|
            row_hash = row.to_hash
            
            # --- NEW: FILTER PENDING ITEMS ---
            # Check the 'statut' column. If it is 'pending', we skip this item entirely.
            current_status = row_hash['statut'].to_s.downcase.strip
            if current_status == 'pending'
              next nil # Returns nil for this iteration
            end
            # ---------------------------------
            
            # --- AUTO-DISCOVERY IMAGE LOGIC ---
            number = row_hash['number']
            
            # 1. Start with 1 (Main image always exists)
            count = 1
            
            # 2. Check for extras: {number}-1, {number}-2...
            loop do
              # Strictly checking for .jpeg only
              next_name = "#{number}-#{count}-2000.jpeg"
              path = File.join(img_dir, next_name)
              
              if File.exist?(path)
                count += 1
              else
                break # Stop counting if file doesn't exist
              end
            end
            
            # 3. Save to data
            row_hash['images'] = count
            row_hash
            # ----------------------------------
          end.compact # .compact removes all the 'nil' values (the pending items)
          
          site.data['catalog'] = rows
          
        rescue => e
          puts "❌ [FrenchCSV] Error: #{e.message}"
        end
      else
        puts "⚠️ [FrenchCSV] Could not find file: #{csv_path}"
      end
    end
  end
end