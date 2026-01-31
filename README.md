NYC Eats began as a response to endless Reddit threads dismissing Restaurant Week as overpriced and underwhelming. The project started by mapping all participating restaurants, unifying menus, prices, and meal types into one interface, and layering in trusted signals—Michelin, Bib Gourmand, and the NYT Top 100—to highlight places genuinely worth visiting.

It has since evolved into a sandbox for next-generation conversational geospatial tools, developed in collaboration with Fulton Ring. With a dataset of roughly 650 restaurants, NYC Eats explores how map agents should work: geocoding natural language, generating isochrones, intersecting mobility ranges, and retrieving contextually relevant venues—all inside a visual, dialog-driven interface. The project sketches what future Gemini-style integrations with Google Maps could feel like and serves as an MVP for more ambitious location-aware AI systems.


Uses Gemini as reasoning agent and https://marauders.earth/ MCP for spatial intellgence tool-calling; semantic_search was built in-house using RAG.


## Expansion projects
- **Rate limits**: MapLibreUse Foursquare Places API (place search, place details, autocomplete), Personalization API (taste-based recommendations à la semantic_search), Snap-to_place (detech which venue a user is physically at, check-ins or "restaurants near me"); Foursquare Tips for reviews. Leans into the user-generated element (shorter, casual tips)
- **Movement in NYC Eats**: 
How It Could Work in NYC Eats                                                                                 
                                                                                                 
  1. "Quiet hours" recommendations                                                                              
                                                                                           
  "Lilia is usually packed at 7pm, but foot traffic drops                                                       
  40% by 9:30pm. Consider a late reservation."                                                                  
                                                                                                                
  2. Real-time neighborhood pulse:                                                                               
  "West Village is busier than usual right now (Citibike                                                        
  arrivals +35% vs typical Thursday 6pm)"                                                                       
                                                                                                                
  3. Subway-aware suggestions                                                                                   
                                                                                                                
  "L train service suspended → Bedford Ave restaurants                                                          
  will be slower tonight. Good time to try that spot                                                            
  you've been eyeing."                                                                                          
                                                                                                                
  4. "Hidden gem" discovery                                                                                     
                                                                                                                
  "This restaurant has great reviews but low foot traffic —                                                     
  locals-only spot, not a tourist trap."                                                                        
                                                                                                                
  5. Post-event predictions                                                                                     
                                                                                                                
  "MSG show ends at 10:30pm. K-Town restaurants will spike.                                                     
  Here are 3 spots likely to have space." 


