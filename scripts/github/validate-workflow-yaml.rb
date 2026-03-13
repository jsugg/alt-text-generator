#!/usr/bin/env ruby

require 'yaml'

repo_root = File.expand_path('../..', __dir__)

Dir[File.join(repo_root, '.github', '**', '*.yml')].sort.each do |file|
  YAML.load_file(file)
  relative_path = file.delete_prefix("#{repo_root}/")
  puts "ok #{relative_path}"
end
